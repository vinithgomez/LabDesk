import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

export type ResourceType = "lab" | "room" | "equipment";
export const RESOURCE_TYPES: readonly ResourceType[] = ["lab", "room", "equipment"];

/** GET /api/resources[/:id] (server/src/routes/resources.routes.ts resourceDto). */
export interface Resource {
  id: string;
  departmentId: string;
  name: string;
  type: ResourceType;
  location: string;
  capacity: number;
  description: string;
  requiresApproval: boolean;
  approvalLevels: number;
  minSlotMinutes: number;
  maxSlotMinutes: number;
  bookingHorizonDays: number;
  /** IST "HH:MM". */
  businessHoursStart: string;
  businessHoursEnd: string;
  /** 0 = Sunday. */
  businessDays: number[];
  isActive: boolean;
  ownerIds: string[];
  owners: { userId: string; approvalLevel: number }[];
}

export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface ResourceFilter {
  type: ResourceType | undefined;
  q: string;
}

/** Bookable resources the caller can see (their department; admins: all), filtered. */
export function useResources(filter: ResourceFilter) {
  const params = new URLSearchParams({ active: "true" });
  if (filter.type) params.set("type", filter.type);
  if (filter.q.trim()) params.set("q", filter.q.trim());
  const qs = params.toString();
  return useQuery({
    queryKey: ["resources", qs],
    queryFn: () => apiRequest<Resource[]>(`/api/resources?${qs}`, { method: "GET" }),
    placeholderData: (previous) => previous,
  });
}

export function useResource(id: string | undefined) {
  return useQuery({
    queryKey: ["resource", id],
    queryFn: () => apiRequest<Resource>(`/api/resources/${id}`, { method: "GET" }),
    enabled: id !== undefined,
  });
}

/** The public department list (names for department ids). */
export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: () => apiRequest<Department[]>("/api/departments", { method: "GET" }),
    staleTime: Infinity,
  });
}

/** `value`, settled for `ms` — so a search box doesn't query on every keystroke. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
