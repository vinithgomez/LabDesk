/**
 * Calendar rules that aren't geometry: which blocks to draw, which times
 * count as open, and when an Idempotency-Key is reused. Pure, like grid.ts.
 */
import { STATUS_LABEL } from "../bookings/status";
import type { Booking, BookingStatus, BusyInterval } from "../bookings/types";
import { parseHhmm, weekday, type DayKey, type Interval } from "./grid";

/** Statuses that hold a slot (the bookings_no_overlap constraint's WHERE clause). */
export const HOLDING: readonly BookingStatus[] = ["pending", "approved", "checked_in"];

export interface MineBlock extends Interval {
  id: string;
  status: BookingStatus;
  purpose: string;
  /** Drawn before the server has answered. */
  optimistic: boolean;
}

export interface WeekEvents {
  /** Other people's held slots: drawn as plain "Busy". */
  others: Interval[];
  maintenance: Interval[];
  mine: MineBlock[];
  /** Everything a new selection must not cover. */
  blocking: Interval[];
}

export const OPTIMISTIC_ID = "optimistic";

const toInterval = (x: { start: string; end: string }): Interval => ({ start: new Date(x.start), end: new Date(x.end) });
const sameInterval = (a: Interval, b: Interval) =>
  a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();

/**
 * Splits availability and the caller's own bookings into what to draw.
 * Availability is anonymous, so a busy interval matching one of the
 * caller's held bookings exactly is that booking and is drawn only once, as
 * theirs. Cancelled bookings aren't drawn.
 */
export function weekEvents(busy: readonly BusyInterval[], mine: readonly Booking[]): WeekEvents {
  const mineBlocks: MineBlock[] = mine
    .filter((b) => b.status !== "cancelled")
    .map((b) => ({ ...toInterval(b), id: b.id, status: b.status, purpose: b.purpose, optimistic: b.id === OPTIMISTIC_ID }));
  const mineHolding = mineBlocks.filter((b) => HOLDING.includes(b.status));

  const others: Interval[] = [];
  const maintenance: Interval[] = [];
  for (const item of busy) {
    const interval = toInterval(item);
    if (item.kind === "maintenance") maintenance.push(interval);
    else if (!mineHolding.some((m) => sameInterval(m, interval))) others.push(interval);
  }
  return { others, maintenance, mine: mineBlocks, blocking: [...others, ...maintenance, ...mineHolding] };
}

/** Is `minute` of `day` inside the resource's business hours and days? Outside is shaded, not forbidden. */
export function isOpen(
  day: DayKey,
  minute: number,
  hours: { businessHoursStart: string; businessHoursEnd: string; businessDays: readonly number[] },
): boolean {
  return (
    hours.businessDays.includes(weekday(day)) &&
    minute >= parseHhmm(hours.businessHoursStart) &&
    minute < parseHhmm(hours.businessHoursEnd)
  );
}

// ---------------------------------------------------------------------------
// Submit attempts

/** One booking attempt: the request it sends, and the Idempotency-Key it sends it with. */
export interface Attempt {
  signature: string;
  key: string;
}

/** Identifies a request body, so a retry of the same request is recognised. */
export function attemptSignature(body: object): string {
  return JSON.stringify(body);
}

/**
 * The attempt to submit `signature` under. Resubmitting the same request
 * after an unknown outcome (network failure, server error) reuses its key,
 * so the server replays rather than books twice; any change to the request
 * starts a new attempt with a new key.
 */
export function nextAttempt(previous: Attempt | null, signature: string, newKey: () => string): Attempt {
  return previous !== null && previous.signature === signature ? previous : { signature, key: newKey() };
}

/**
 * Whether the outcome of a failed request is unknown, so a retry must be
 * the same attempt. Any other failure is a definite answer, and the next
 * submit is a new attempt.
 */
export function outcomeUnknown(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("status" in err) || typeof err.status !== "number") return true;
  // A success status with an unreadable body may still have booked.
  if ("code" in err && err.code === "BAD_RESPONSE") return true;
  return err.status === 0 || err.status >= 500;
}

// ---------------------------------------------------------------------------
// Screen-reader text

/** What a grid cell holds, for its accessible name. */
export function describeCell(cell: Interval, events: WeekEvents, blocked: boolean): string {
  const hit = (i: Interval) => i.start < cell.end && cell.start < i.end;
  const mine = events.mine.find(hit);
  if (mine) return `your booking${mine.purpose ? `, ${mine.purpose}` : ""}, ${STATUS_LABEL[mine.status].toLowerCase()}`;
  if (events.maintenance.some(hit)) return "maintenance";
  if (events.others.some(hit)) return "busy";
  return blocked ? "unavailable" : "free";
}
