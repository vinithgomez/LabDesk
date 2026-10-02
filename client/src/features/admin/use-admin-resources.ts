import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiBlob, apiRequest } from "../../lib/api";
import type { Resource } from "../resources/use-resources";
import { toCreateBody, toUpdateBody, type OwnerDraft, type ResourceFormValues } from "./resource-form";

/** Every resource an admin can see: all departments, inactive ones too. */
export function useAdminResources() {
  return useQuery({
    queryKey: ["resources", "admin"],
    queryFn: () => apiRequest<Resource[]>("/api/resources", { method: "GET" }),
  });
}

/**
 * Create, or apply an edit as one PATCH: the changed settings and, when the
 * owner set changed, the owners with them. The server checks the result as
 * a whole and applies all of it or none.
 */
export function useSaveResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { original: Resource | null; values: ResourceFormValues; owners: OwnerDraft[] }) => {
      const { original, values, owners } = input;
      if (!original) {
        return apiRequest<Resource>("/api/resources", { method: "POST", body: toCreateBody(values, owners) });
      }
      const body = toUpdateBody(values, original, owners);
      if (!body) return original;
      return apiRequest<Resource>(`/api/resources/${original.id}`, { method: "PATCH", body });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["resources"] }),
  });
}

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
