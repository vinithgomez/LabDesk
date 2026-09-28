import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { ApiError, apiRequest } from "../../lib/api";
import { describeApiError } from "../../lib/api-errors";
import type { Availability, Booking, NewBooking } from "../bookings/types";
import type { Resource } from "../resources/use-resources";
import { formatPeriod } from "./format";
import { addDays, istDayStart, type DayKey } from "./grid";
import { attemptSignature, nextAttempt, OPTIMISTIC_ID, outcomeUnknown, type Attempt } from "./model";

/** The UTC window covering an IST week, as the API wants it. */
function weekWindow(weekStart: DayKey) {
  return { from: istDayStart(weekStart).toISOString(), to: istDayStart(addDays(weekStart, 7)).toISOString() };
}

export const availabilityKey = (resourceId: string, weekStart: DayKey) => ["availability", resourceId, weekStart];
export const myWeekKey = (resourceId: string, weekStart: DayKey) => ["bookings", "mine", "week", resourceId, weekStart];

/** Anonymous busy times and maintenance for one resource-week. */
export function useAvailability(resourceId: string, weekStart: DayKey) {
  const { from, to } = weekWindow(weekStart);
  return useQuery({
    queryKey: availabilityKey(resourceId, weekStart),
    queryFn: () =>
      apiRequest<Availability>(`/api/resources/${resourceId}/availability?from=${from}&to=${to}`, { method: "GET" }),
    placeholderData: (previous) => previous,
  });
}

/** The caller's own bookings on one resource in one week. */
export function useMyWeekBookings(resourceId: string, weekStart: DayKey) {
  const { from, to } = weekWindow(weekStart);
  return useQuery({
    queryKey: myWeekKey(resourceId, weekStart),
    queryFn: () =>
      apiRequest<Booking[]>(`/api/bookings?mine=true&resourceId=${resourceId}&from=${from}&to=${to}&limit=200`, {
        method: "GET",
      }),
    placeholderData: (previous) => previous,
  });
}

export interface Draft {
  start: Date;
  end: Date;
  purpose: string;
  attendeeCount: number;
}

export type PanelOutcome =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "booked"; booking: Booking }
  | { kind: "failed"; message: string; conflict: boolean }
  | { kind: "joiningWaitlist" }
  | { kind: "waitlisted" }
  | { kind: "waitlistFailed"; message: string };

const newKey = () => crypto.randomUUID();

/**
 * Booking from the calendar: optimistic create, honest rollback, and the
 * waitlist offer after a conflict.
 *
 * The block appears at once; if the server refuses, it is removed again,
 * and on SLOT_CONFLICT (or maintenance) availability is refetched so the
 * winner's block is drawn. Each submit attempt has one Idempotency-Key,
 * reused only when retrying a request whose outcome is unknown.
 */
export function useBookingPanel(resource: Resource, weekStart: DayKey) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<PanelOutcome>({ kind: "idle" });
  /** Text for the page's aria-live region: each result, once. */
  const [announcement, setAnnouncement] = useState("");
  const attempt = useRef<Attempt | null>(null);
  const mineKey = myWeekKey(resource.id, weekStart);

  const create = useMutation({
    mutationFn: ({ body, key }: { body: NewBooking; key: string }) =>
      apiRequest<Booking>("/api/bookings", { method: "POST", body, headers: { "Idempotency-Key": key } }),
    onMutate: async ({ body }) => {
      await queryClient.cancelQueries({ queryKey: mineKey });
      const previous = queryClient.getQueryData<Booking[]>(mineKey);
      const now = new Date().toISOString();
      const optimistic: Booking = {
        ...body,
        id: OPTIMISTIC_ID,
        userId: "",
        status: resource.requiresApproval ? "pending" : "approved",
        seriesId: null,
        cancelledByMaintenanceId: null,
        createdAt: now,
        updatedAt: now,
      };
      queryClient.setQueryData<Booking[]>(mineKey, [...(previous ?? []), optimistic]);
      return { previous };
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(mineKey, context?.previous);
      if (err instanceof ApiError && (err.code === "SLOT_CONFLICT" || err.code === "MAINTENANCE_BLOCKED")) {
        void queryClient.invalidateQueries({ queryKey: availabilityKey(resource.id, weekStart) });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
      void queryClient.invalidateQueries({ queryKey: availabilityKey(resource.id, weekStart) });
    },
  });

  const waitlist = useMutation({
    mutationFn: (draft: Draft) =>
      apiRequest<unknown>("/api/waitlist", {
        method: "POST",
        body: {
          resourceId: resource.id,
          desiredPeriod: { start: draft.start.toISOString(), end: draft.end.toISOString() },
          purpose: draft.purpose,
          attendeeCount: draft.attendeeCount,
        },
      }),
  });

  const book = useCallback(
    async (draft: Draft) => {
      const body: NewBooking = {
        resourceId: resource.id,
        start: draft.start.toISOString(),
        end: draft.end.toISOString(),
        purpose: draft.purpose.trim(),
        attendeeCount: draft.attendeeCount,
      };
      const current = nextAttempt(attempt.current, attemptSignature(body), newKey);
      attempt.current = current;
      setOutcome({ kind: "submitting" });
      try {
        const booking = await create.mutateAsync({ body, key: current.key });
        attempt.current = null;
        setOutcome({ kind: "booked", booking });
        setAnnouncement(
          `Booked ${formatPeriod(draft.start, draft.end)}. ${booking.status === "pending" ? "Waiting for approval." : "Approved."}`,
        );
      } catch (err) {
        if (!outcomeUnknown(err)) attempt.current = null;
        const conflict = err instanceof ApiError && err.code === "SLOT_CONFLICT";
        const message = describeApiError(err, { resource, period: draft, now: new Date() });
        setOutcome({ kind: "failed", message, conflict });
        setAnnouncement(`Not booked. ${message}`);
      }
    },
    [create, resource],
  );

  const joinWaitlist = useCallback(
    async (draft: Draft) => {
      setOutcome({ kind: "joiningWaitlist" });
      try {
        await waitlist.mutateAsync(draft);
        setOutcome({ kind: "waitlisted" });
        setAnnouncement(`Added to the waitlist for ${formatPeriod(draft.start, draft.end)}.`);
      } catch (err) {
        const message = describeApiError(err, { resource, period: draft });
        setOutcome({ kind: "waitlistFailed", message });
        setAnnouncement(`Not added to the waitlist. ${message}`);
      }
    },
    [waitlist, resource],
  );

  /** A new selection: forget the last result (an unfinished attempt is kept for its retry). */
  const reset = useCallback(() => {
    setOutcome({ kind: "idle" });
    setAnnouncement("");
  }, []);

  return { outcome, announcement, book, joinWaitlist, reset };
}
