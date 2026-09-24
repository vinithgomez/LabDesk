/**
 * Pure booking-slot rules (CLAUDE.md §2b, §4). No I/O: the service loads the
 * resource and supplies `now`. Overlap is NOT checked here — that is the
 * database's job (bookings_no_overlap).
 */
import { DomainError } from "./errors.js";
import type { Resource } from "./types.js";

/** India Standard Time is a fixed UTC+05:30 with no daylight saving. */
const IST_OFFSET_MS = 330 * 60_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The IST calendar date (YYYY-MM-DD) an instant falls on. */
export function istDate(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface SlotRequest {
  startsAt: Date;
  endsAt: Date;
  attendeeCount: number;
}

export type SlotRules = Pick<Resource, "capacity" | "minSlotMinutes" | "maxSlotMinutes" | "bookingHorizonDays">;

/** The instant an IST wall-clock time ("HH:MM") falls on an IST date ("YYYY-MM-DD"). */
export function istInstant(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+05:30`);
}

/**
 * Throws the DomainError for the first rule the slot breaks. Periods are
 * half-open [start, end), so a booking ending exactly at IST midnight is
 * still a same-day booking.
 */
export function assertBookableSlot(resource: SlotRules, slot: SlotRequest, now: Date): void {
  assertSlotLength(resource, slot);
  assertWithinHorizon(resource, slot, now);
  assertCapacity(resource, slot.attendeeCount);
}

/** Same IST day, and within the resource's min/max slot length. */
export function assertSlotLength(resource: SlotRules, slot: Pick<SlotRequest, "startsAt" | "endsAt">): void {
  const end = slot.endsAt.getTime();
  const minutes = (end - slot.startsAt.getTime()) / MINUTE_MS;

  if (istDate(slot.startsAt) !== istDate(new Date(end - 1))) {
    throw new DomainError(
      "MULTI_DAY_NOT_SUPPORTED",
      "A booking must start and end on the same calendar day (IST)",
    );
  }
  if (minutes > resource.maxSlotMinutes) {
    throw new DomainError(
      "SLOT_TOO_LONG",
      `This resource can be booked for at most ${resource.maxSlotMinutes} minutes at a time`,
    );
  }
  if (minutes < resource.minSlotMinutes) {
    throw new DomainError(
      "SLOT_TOO_SHORT",
      `This resource must be booked for at least ${resource.minSlotMinutes} minutes`,
    );
  }
}

/** Not in the past, and ending within the resource's booking horizon. */
export function assertWithinHorizon(
  resource: SlotRules,
  slot: Pick<SlotRequest, "startsAt" | "endsAt">,
  now: Date,
): void {
  if (slot.startsAt.getTime() < now.getTime()) {
    throw new DomainError("OUTSIDE_HORIZON", "Bookings cannot start in the past");
  }
  if (slot.endsAt.getTime() > horizonEnd(resource, now).getTime()) {
    throw new DomainError(
      "OUTSIDE_HORIZON",
      `This resource can only be booked up to ${resource.bookingHorizonDays} days ahead`,
    );
  }
}

/** The latest instant a booking made at `now` may end. */
export function horizonEnd(resource: Pick<SlotRules, "bookingHorizonDays">, now: Date): Date {
  return new Date(now.getTime() + resource.bookingHorizonDays * DAY_MS);
}

export function assertCapacity(resource: SlotRules, attendeeCount: number): void {
  // capacity 0 means "not people-limited" (e.g. some equipment).
  if (resource.capacity > 0 && attendeeCount > resource.capacity) {
    throw new DomainError(
      "CAPACITY_EXCEEDED",
      `This resource holds at most ${resource.capacity} people`,
    );
  }
}
