import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiBlob, apiRequest } from "../../lib/api";
import { describeApiError } from "../../lib/api-errors";
import type { Resource } from "../resources/use-resources";
import {
  ownersChanged,
  saveOrder,
  toCreateBody,
  toPatchBody,
  type OwnerDraft,
  type ResourceFields,
  type ResourceFormValues,
} from "./resource-form";

/** Every resource an admin can see: all departments, inactive ones too. */
export function useAdminResources() {
  return useQuery({
    queryKey: ["resources", "admin"],
    queryFn: () => apiRequest<Resource[]>("/api/resources", { method: "GET" }),
  });
}

export const ownersOf = (r: Resource): OwnerDraft[] =>
  r.owners.map((o) => ({ userId: o.userId, approvalLevel: o.approvalLevel === 2 ? 2 : 1 }));

/** Shown when an edit can't be applied as two requests in either order. */
export const IMPOSSIBLE_SAVE =
  "This can't be saved in one go: while bookings need approval, the server checks owners against the current number of levels and the levels against the current owners, so changing the number of levels fails either way. Untick \"Bookings need approval\" and save, change the levels and owners, then turn approval back on (bookings made in between are approved automatically).";

export class SaveError extends Error {}

/**
 * Create, or apply an edit. An edit may be two requests (settings, then
 * owners, or the other way round; see saveOrder). If the second fails after
 * the first succeeded, the message says what was saved.
 */
export function useSaveResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { original: Resource | null; values: ResourceFormValues; owners: OwnerDraft[] }) => {
      const { original, values, owners } = input;
      if (!original) {
        return apiRequest<Resource>("/api/resources", { method: "POST", body: toCreateBody(values, owners) });
      }
      const patch = toPatchBody(values, original);
      const nextOwners = ownersChanged(ownersOf(original), owners) ? owners : null;
      const order = saveOrder(original, ownersOf(original), patch, nextOwners);
      const patchFields = (body: Partial<ResourceFields>) =>
        apiRequest<Resource>(`/api/resources/${original.id}`, { method: "PATCH", body });
      const putOwners = (list: OwnerDraft[]) =>
        apiRequest<Resource>(`/api/resources/${original.id}/owners`, { method: "PATCH", body: { owners: list } });

      switch (order) {
        case "nothing":
          return original;
        case "impossible":
          throw new SaveError(IMPOSSIBLE_SAVE);
        case "fields":
          return patchFields(patch ?? {});
        case "owners":
          return putOwners(owners);
        case "owners-then-fields":
          await putOwners(owners);
          return secondStep(() => patchFields(patch ?? {}), "the owners", "the other settings");
        case "fields-then-owners":
          await patchFields(patch ?? {});
          return secondStep(() => putOwners(owners), "the settings", "the owners");
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["resources"] }),
  });
}

async function secondStep(run: () => Promise<Resource>, saved: string, notSaved: string): Promise<Resource> {
  try {
    return await run();
  } catch (err) {
    throw new SaveError(`Saved ${saved}, but not ${notSaved}: ${describeApiError(err)}`);
  }
}

/** The sentence for a failed save. */
export const describeSaveError = (err: unknown): string =>
  err instanceof SaveError ? err.message : describeApiError(err);

/** Soft delete: new bookings are refused; existing ones are untouched. */
export function useSetResourceActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ resource, active }: { resource: Resource; active: boolean }) =>
      active
        ? apiRequest<Resource>(`/api/resources/${resource.id}`, { method: "PATCH", body: { isActive: true } })
        : apiRequest<Resource>(`/api/resources/${resource.id}`, { method: "DELETE" }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["resources"] }),
  });
}

/** Saves the resource's printable check-in QR code (PNG) to the user's machine. */
export function useDownloadQr() {
  return useMutation({
    mutationFn: async (resource: Resource) => {
      const blob = await apiBlob(`/api/resources/${resource.id}/qr`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `labdesk-qr-${resource.name.replace(/[^\w-]+/g, "-").toLowerCase()}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    },
  });
}
