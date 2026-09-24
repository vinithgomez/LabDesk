/**
 * Attendance timing (CLAUDE.md §5, §7). Pure: callers supply `now`.
 *
 * Every window is paired with the job that takes over when it closes, and
 * the two meet at a single instant — the window is inclusive, the job's
 * condition strict — so outcomes never depend on when a job happens to run:
 *
 *   check-in   [start - 15m, start + 15m]   then no-show   when now >  start + 15m
 *   check-out  while checked in, ≤ end + 15m then auto-complete when now > end + 15m
 *   approval   before start (Phase 3)        then expiry    when now >= start
 */
import type { Booking } from "./types.js";

/** §7: scans are accepted within ±15 minutes of the booked period. */
export const CHECKIN_TOLERANCE_MS = 15 * 60_000;
/** §5: grace_minutes (default 15) before an unattended booking is a no-show. */
export const NO_SHOW_GRACE_MS = 15 * 60_000;

export interface TimeWindow {
  opensAt: Date;
  closesAt: Date;
}

type Period = Pick<Booking, "startsAt" | "endsAt">;

const shift = (d: Date, ms: number): Date => new Date(d.getTime() + ms);

export function isWithin(window: TimeWindow, now: Date): boolean {
  return now.getTime() >= window.opensAt.getTime() && now.getTime() <= window.closesAt.getTime();
}

/**
 * First scan. Opens 15 minutes early and closes at start + grace — exactly
 * where the no-show rule begins. Arriving later than that is a no-show, even
 * though the period itself is still running.
 */
export function checkInWindow(b: Period): TimeWindow {
  return { opensAt: shift(b.startsAt, -CHECKIN_TOLERANCE_MS), closesAt: shift(b.startsAt, NO_SHOW_GRACE_MS) };
}

/** Second scan while checked in: any time up to 15 minutes past the end. */
export function checkOutWindow(b: Period): TimeWindow {
  return { opensAt: shift(b.startsAt, -CHECKIN_TOLERANCE_MS), closesAt: shift(b.endsAt, CHECKIN_TOLERANCE_MS) };
}

/** §5: now > period.lower + grace (and no check-in; the caller checks that). */
export function isNoShowDue(b: Period, now: Date): boolean {
  return now.getTime() > b.startsAt.getTime() + NO_SHOW_GRACE_MS;
}

/** A checked-in session nobody checked out of, once check-out has closed. */
export function isAutoCompleteDue(b: Period, now: Date): boolean {
  return now.getTime() > b.endsAt.getTime() + CHECKIN_TOLERANCE_MS;
}

/** A pending booking can no longer be approved once it has started (Phase 3). */
export function isLapsedPending(b: Period, now: Date): boolean {
  return now.getTime() >= b.startsAt.getTime();
}

export type ScanOutcome =
  | { kind: "checkin"; booking: Booking }
  | { kind: "checkout"; booking: Booking }
  | { kind: "none"; nearest: Booking | null };

/**
 * What a scan by this user means, given their bookings on the resource.
 * An active session wins: the scan checks it out, even if the next booking's
 * check-in window has also opened (back-to-back bookings); the following
 * scan then checks in to the next one.
 */
export function decideScan(bookings: readonly Booking[], now: Date): ScanOutcome {
  const active = bookings.find((b) => b.status === "checked_in" && isWithin(checkOutWindow(b), now));
  if (active) return { kind: "checkout", booking: active };
  const due = bookings.find((b) => b.status === "approved" && isWithin(checkInWindow(b), now));
  if (due) return { kind: "checkin", booking: due };

  const nearest = [...bookings].sort(
    (a, b) => distanceMs(a, now) - distanceMs(b, now),
  )[0];
  return { kind: "none", nearest: nearest ?? null };
}

function distanceMs(b: Period, now: Date): number {
  const t = now.getTime();
  if (t < b.startsAt.getTime()) return b.startsAt.getTime() - t;
  if (t > b.endsAt.getTime()) return t - b.endsAt.getTime();
  return 0;
}

/** A human explanation for NO_ACTIVE_BOOKING, naming the nearby booking's time (UTC). */
export function explainNoActiveBooking(nearest: Booking | null, now: Date): string {
  if (!nearest) return "You have no booking on this resource around this time.";
  const when = `${nearest.startsAt.toISOString()}–${nearest.endsAt.toISOString()}`;
  if (nearest.status === "pending") return `Your booking for ${when} is still awaiting approval.`;
  if (nearest.status === "checked_in") return `Your session for ${when} has ended; check-out closed at ${checkOutWindow(nearest).closesAt.toISOString()}.`;
  const window = checkInWindow(nearest);
  if (now.getTime() < window.opensAt.getTime()) {
    return `Too early: your booking is ${when}. Check-in opens at ${window.opensAt.toISOString()}.`;
  }
  return `Check-in for your booking ${when} closed at ${window.closesAt.toISOString()}, 15 minutes after it started.`;
}
