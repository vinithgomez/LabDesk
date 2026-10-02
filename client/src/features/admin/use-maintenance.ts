import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api";
import type { Availability } from "../bookings/types";
import { MAX_PREVIEW_MS, overlappingBookings, type Severity } from "./maintenance";

export interface MaintenanceWindow {
  id: string;
  resourceId: string;
  start: string;
  end: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  removedAt: string | null;
  removedBy: string | null;
}

/** A resource's upcoming windows. */
export function useMaintenanceWindows(resourceId: string) {
  return useQuery({
    queryKey: ["maintenance", resourceId],
    queryFn: () => apiRequest<MaintenanceWindow[]>(`/api/maintenance?resourceId=${resourceId}`, { method: "GET" }),
    enabled: resourceId !== "",
  });
}

/**
 * How many bookings a window would cancel right now, from availability.
 * Null while unknown, or when the window is longer than availability answers for.
 */
export function useOverlapPreview(resourceId: string, start: Date | null, end: Date | null) {
  const ok = resourceId !== "" && start !== null && end !== null && end > start && end.getTime() - start.getTime() <= MAX_PREVIEW_MS;
  const query = useQuery({
    queryKey: ["availability", resourceId, "preview", start?.toISOString(), end?.toISOString()],
    queryFn: () =>
      apiRequest<Availability>(
        `/api/resources/${resourceId}/availability?from=${start?.toISOString()}&to=${end?.toISOString()}`,
        { method: "GET" },
      ),
    enabled: ok,
  });
  return ok && query.data && start && end ? overlappingBookings(query.data.busy, start, end) : null;
}

export function useCreateMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { resourceId: string; start: string; end: string; reason: string }) =>
      apiRequest<MaintenanceWindow & { cancelledBookingIds: string[] }>("/api/maintenance", { method: "POST", body }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

/** Soft delete. Bookings the window cancelled stay cancelled. */
export function useRemoveMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<MaintenanceWindow>(`/api/maintenance/${id}`, { method: "DELETE" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
  });
}

export interface Incident {
  id: string;
  resourceId: string;
  bookingId: string | null;
  reportedBy: string;
  severity: Severity;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string;
}

export type IncidentState = "open" | "resolved" | "all";

/** A resource's incidents (its owners and admins). */
export function useIncidents(resourceId: string, state: IncidentState) {
  return useQuery({
    queryKey: ["incidents", resourceId, state],
    queryFn: () => apiRequest<Incident[]>(`/api/incidents?resourceId=${resourceId}&state=${state}&limit=200`, { method: "GET" }),
    enabled: resourceId !== "",
  });
}

export function useReportIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { resourceId: string; severity: Severity; description: string }) =>
      apiRequest<Incident>("/api/incidents", { method: "POST", body: { ...body, description: body.description.trim() } }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["incidents"] }),
  });
}

export function useResolveIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) =>
      apiRequest<Incident>(`/api/incidents/${id}/resolve`, { method: "PATCH", body: { resolution: resolution.trim() } }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["incidents"] }),
  });
}
