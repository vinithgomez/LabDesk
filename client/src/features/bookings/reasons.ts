/**
 * My-bookings rules, kept out of the components: which tab a booking is on,
 * whether it can still be cancelled, and why the system ended it.
 */
import type { Booking, BookingDetail, BookingStatus } from "./types";

const DAY_MS = 86_400_000;
/** The past tab loads in windows of this many days, newest first. */
export const PAST_WINDOW_DAYS = 30;

/** Upcoming: not yet over (includes one in progress). Past: ended. Soonest / newest first. */
export function splitByTime(bookings: readonly Booking[], now: Date): { upcoming: Booking[]; past: Booking[] } {
  const unique = [...new Map(bookings.map((b) => [b.id, b])).values()];
  const ended = (b: Booking) => new Date(b.end).getTime() <= now.getTime();
  return {
    upcoming: unique.filter((b) => !ended(b)).sort((a, b) => a.start.localeCompare(b.start)),
    past: unique.filter(ended).sort((a, b) => b.start.localeCompare(a.start)),
  };
}

/**
 * The window for page `page` of the past tab (0 = the most recent). The
 * list endpoint returns the earliest matches first and caps the count, so
 * asking for "everything before now" could miss the newest; walking back in
 * windows keeps each request small and in order.
 */
export function pastWindow(page: number, now: Date): { from: Date; to: Date } {
  const to = new Date(now.getTime() - page * PAST_WINDOW_DAYS * DAY_MS);
  return { from: new Date(to.getTime() - PAST_WINDOW_DAYS * DAY_MS), to };
}

/** Bookers may cancel until check-in (§5). */
export function canCancel(status: BookingStatus): boolean {
  return status === "pending" || status === "approved";
}

/** Rows whose reason needs the booking's detail (approvals, cancellation). */
export function needsDetail(booking: Booking): boolean {
  return booking.status === "rejected" || booking.cancelledByMaintenanceId !== null;
}

export type Reason =
  | { kind: "maintenance"; start: Date; end: Date; reason: string }
  | { kind: "expired" }
  | { kind: "rejected"; level: number; comment: string };

/**
 * Why the booking ended without happening. A lapsed approval is stored as
 * `rejected` with no one having rejected it (§2c: the expiry job has no
 * actor), so "rejected with no rejecting decision" is an expiry.
 */
export function bookingReason(detail: BookingDetail): Reason | null {
  if (detail.cancellation) {
    const m = detail.cancellation.maintenance;
    return { kind: "maintenance", start: new Date(m.start), end: new Date(m.end), reason: m.reason };
  }
  if (detail.status !== "rejected") return null;
  const rejection = detail.approvals.find((a) => a.decision === "rejected");
  return rejection ? { kind: "rejected", level: rejection.level, comment: rejection.comment } : { kind: "expired" };
}

/** The badge to show: an expired booking reads "Expired", not "Rejected". */
export function displayStatus(booking: Booking, reason: Reason | null): BookingStatus | "expired" {
  return reason?.kind === "expired" ? "expired" : booking.status;
}
