import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api";
import type { SeriesDetail } from "./types";

export const seriesKey = (id: string) => ["series", id];

/** A series with its booked and skipped occurrences (booker, the resource's owners, admins). */
export function useSeries(id: string | undefined) {
  return useQuery({
    queryKey: seriesKey(id ?? ""),
    queryFn: () => apiRequest<SeriesDetail>(`/api/series/${id}`, { method: "GET" }),
    enabled: id !== undefined,
  });
}

/** Cancels the series and its pending or approved occurrences that haven't started. */
export function useCancelSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<SeriesDetail>(`/api/series/${id}`, { method: "DELETE" }),
    onSuccess: (series) => queryClient.setQueryData(seriesKey(series.id), series),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
  });
}

/** The confirm step's words: what cancelling touches and what it leaves alone. */
export const CANCEL_SERIES_WARNING =
  "Cancel this repeating booking? Every future date that is pending or approved will be cancelled, and no more dates will be booked. Dates that have already started, are checked in, or are over are not touched.";
