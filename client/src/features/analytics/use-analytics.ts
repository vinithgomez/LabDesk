import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiRequest } from "../../lib/api";
import type { Department, HeatmapReport, IdleRankingReport, NoShowReport, UtilizationReport } from "./types";

const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

/**
 * What the dashboard shows: the last `weeks` weeks, for `department`
 * (undefined = the caller's own; "all" or another id only for admins, which
 * the server enforces).
 */
export interface AnalyticsFilter {
  weeks: number;
  department: string | undefined;
}

type Endpoint = "utilization" | "no-shows" | "heatmap" | "idle-ranking";

/**
 * The window starts `weeks` before the current hour (rounded, so the query
 * key stays stable while the page is open); its end defaults to now on the
 * server.
 */
function useQueryString(filter: AnalyticsFilter): string {
  return useMemo(() => {
    const from = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS - filter.weeks * WEEK_MS);
    const params = new URLSearchParams({ from: from.toISOString() });
    if (filter.department) params.set("departmentId", filter.department);
    return params.toString();
  }, [filter.weeks, filter.department]);
}

function useAnalytics<T>(endpoint: Endpoint, filter: AnalyticsFilter, enabled: boolean) {
  const qs = useQueryString(filter);
  return useQuery({
    queryKey: ["analytics", endpoint, qs],
    queryFn: () => apiRequest<T>(`/api/analytics/${endpoint}?${qs}`, { method: "GET" }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export const useUtilization = (f: AnalyticsFilter, enabled: boolean) =>
  useAnalytics<UtilizationReport>("utilization", f, enabled);
export const useNoShows = (f: AnalyticsFilter, enabled: boolean) => useAnalytics<NoShowReport>("no-shows", f, enabled);
export const useHeatmap = (f: AnalyticsFilter, enabled: boolean) => useAnalytics<HeatmapReport>("heatmap", f, enabled);
export const useIdleRanking = (f: AnalyticsFilter, enabled: boolean) =>
  useAnalytics<IdleRankingReport>("idle-ranking", f, enabled);

/** Public list, for the admin's department picker. */
export function useDepartments(enabled: boolean) {
  return useQuery({
    queryKey: ["departments"],
    queryFn: () => apiRequest<Department[]>("/api/departments", { method: "GET" }),
    enabled,
    staleTime: Infinity,
  });
}
