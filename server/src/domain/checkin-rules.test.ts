import { describe, expect, it } from "vitest";
import {
  checkInWindow,
  checkOutWindow,
  decideScan,
  explainNoActiveBooking,
  isAutoCompleteDue,
  isLapsedPending,
  isNoShowDue,
  isWithin,
} from "./checkin-rules.js";
import type { Booking, BookingStatus } from "./types.js";

const MIN = 60_000;
const START = new Date("2026-10-05T04:30:00.000Z");
const END = new Date(START.getTime() + 60 * MIN);
const at = (offsetMs: number, from: Date = START) => new Date(from.getTime() + offsetMs);

const booking = (status: BookingStatus, start = START, end = END, id = "b"): Booking => ({
  id,
  resourceId: "r",
  userId: "u",
  startsAt: start,
  endsAt: end,
  status,
  purpose: "",
  attendeeCount: 1,
  seriesId: null,
  cancelledByMaintenanceId: null,
  createdAt: START,
  updatedAt: START,
});

describe("windows meet their jobs at a single instant", () => {
  it("check-in: open [start-15m, start+15m]; no-show strictly after start+15m", () => {
    const w = checkInWindow(booking("approved"));
    expect(isWithin(w, at(-15 * MIN - 1))).toBe(false);
    expect(isWithin(w, at(-15 * MIN))).toBe(true);
    expect(isWithin(w, at(15 * MIN))).toBe(true);
    expect(isWithin(w, at(15 * MIN + 1))).toBe(false);

    expect(isNoShowDue(booking("approved"), at(15 * MIN))).toBe(false);
    expect(isNoShowDue(booking("approved"), at(15 * MIN + 1))).toBe(true);
  });

  it("check-out: open until end+15m; auto-complete strictly after", () => {
    const w = checkOutWindow(booking("checked_in"));
    expect(isWithin(w, at(15 * MIN, END))).toBe(true);
    expect(isWithin(w, at(15 * MIN + 1, END))).toBe(false);
    expect(isAutoCompleteDue(booking("checked_in"), at(15 * MIN, END))).toBe(false);
    expect(isAutoCompleteDue(booking("checked_in"), at(15 * MIN + 1, END))).toBe(true);
  });

  it("pending lapses at the start instant", () => {
    expect(isLapsedPending(booking("pending"), at(-1))).toBe(false);
    expect(isLapsedPending(booking("pending"), START)).toBe(true);
  });
});

describe("decideScan", () => {
  it("checks in an approved booking inside its window, checks out an active session", () => {
    expect(decideScan([booking("approved")], START)).toMatchObject({ kind: "checkin" });
    expect(decideScan([booking("checked_in")], at(30 * MIN))).toMatchObject({ kind: "checkout" });
  });

  it("prefers checking out the active session over checking in to a back-to-back booking", () => {
    const next = booking("approved", END, at(60 * MIN, END), "next");
    const outcome = decideScan([booking("checked_in"), next], at(5 * MIN, END));
    expect(outcome).toMatchObject({ kind: "checkout", booking: { id: "b" } });
  });

  it("reports the nearest booking when there is nothing to do now", () => {
    const later = booking("approved", at(3 * 60 * MIN), at(4 * 60 * MIN), "later");
    const outcome = decideScan([later], START);
    expect(outcome).toMatchObject({ kind: "none", nearest: { id: "later" } });
    expect(decideScan([], START)).toEqual({ kind: "none", nearest: null });
  });
});

describe("explainNoActiveBooking", () => {
  it("names the booking time and the reason", () => {
    expect(explainNoActiveBooking(booking("approved"), at(-30 * MIN))).toBe(
      `Too early: your booking is ${START.toISOString()}–${END.toISOString()}. Check-in opens at ${at(-15 * MIN).toISOString()}.`,
    );
    expect(explainNoActiveBooking(booking("approved"), at(20 * MIN))).toContain(`closed at ${at(15 * MIN).toISOString()}`);
    expect(explainNoActiveBooking(booking("pending"), START)).toContain("still awaiting approval");
    expect(explainNoActiveBooking(null, START)).toBe("You have no booking on this resource around this time.");
  });
});
