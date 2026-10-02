import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api";
import type { Resource } from "../resources/use-resources";
import { needsDetail, pastWindow } from "./reasons";
import type { Booking, BookingDetail, WaitlistEntry } from "./types";

const LIST_LIMIT = 200;

const listMine = (from: Date | null, to: Date | null) => {
  const params = new URLSearchParams({ mine: "true", limit: String(LIST_LIMIT) });
  if (from) params.set("from", from.toISOString());
  if (to) params.set("to", to.toISOString());
  return apiRequest<Booking[]>(`/api/bookings?${params.toString()}`, { method: "GET" });
};

/** Everything of mine not over at `since`, soonest first (the API's order). */
export function useUpcomingBookings(since: Date) {
  return useQuery({
    queryKey: ["bookings", "mine", "upcoming", since.getTime()],
    queryFn: () => listMine(since, null),
  });
}

/** Past bookings before `until`, loaded backwards in 30-day windows. */
export function usePastBookings(until: Date) {
  return useInfiniteQuery({
    queryKey: ["bookings", "mine", "past", until.getTime()],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const { from, to } = pastWindow(pageParam, until);
      return listMine(from, to).then((bookings) => ({ bookings, truncated: bookings.length >= LIST_LIMIT }));
    },
    getNextPageParam: (_last, pages) => pages.length,
  });
}

/** Details (approval trail, cancellation) for the rows whose reason needs them. */
export function useBookingDetails(bookings: readonly Booking[]) {
  const ids = bookings.filter(needsDetail).map((b) => b.id);
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["bookings", "detail", id],
      queryFn: () => apiRequest<BookingDetail>(`/api/bookings/${id}`, { method: "GET" }),
      staleTime: 5 * 60_000,
    })),
  });
  const details = new Map<string, BookingDetail>();
  results.forEach((r) => {
    if (r.data) details.set(r.data.id, r.data);
  });
  return details;
}

/** Names for resource ids, including inactive resources that old bookings point at. */
export function useResourceNames() {
  const resources = useQuery({
    queryKey: ["resources", "names"],
    queryFn: () => apiRequest<Resource[]>("/api/resources", { method: "GET" }),
    staleTime: 5 * 60_000,
  });
  return (id: string) => resources.data?.find((r) => r.id === id)?.name ?? "…";
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<Booking>(`/api/bookings/${id}/cancel`, { method: "POST" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
  });
}

/** My waitlist entries, newest first. */
export function useMyWaitlist() {
  return useQuery({
    queryKey: ["waitlist", "mine"],
    queryFn: () => apiRequest<WaitlistEntry[]>("/api/waitlist?limit=200", { method: "GET" }),
  });
}

/** Leave the waitlist (waiting entries only). */
export function useLeaveWaitlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<WaitlistEntry>(`/api/waitlist/${id}`, { method: "DELETE" }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["waitlist"] }),
  });
}

/** The caller's private ICS feed URL, and replacing it. */
export function useCalendarFeed() {
  const queryClient = useQueryClient();
  const feed = useQuery({
    queryKey: ["calendar-feed"],
    queryFn: () => apiRequest<{ url: string }>("/api/calendar/feed", { method: "GET" }),
    staleTime: Infinity,
  });
  const regenerate = useMutation({
    mutationFn: () => apiRequest<{ url: string }>("/api/calendar/feed/regenerate", { method: "POST" }),
    onSuccess: (data) => queryClient.setQueryData(["calendar-feed"], data),
  });
  return { feed, regenerate };
}
