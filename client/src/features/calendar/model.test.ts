import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import type { Booking, BusyInterval } from "../bookings/types";
import { attemptSignature, describeCell, isOpen, nextAttempt, outcomeUnknown, weekEvents } from "./model";

const ist = (local: string) => new Date(`${local}+05:30`).toISOString();
const booking = (over: Partial<Booking>): Booking => ({
  id: "b1",
  resourceId: "r1",
  userId: "u1",
  start: ist("2026-09-29T10:00:00"),
  end: ist("2026-09-29T11:00:00"),
  status: "approved",
  purpose: "Lab",
  attendeeCount: 1,
  seriesId: null,
  cancelledByMaintenanceId: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("weekEvents", () => {
  const busy: BusyInterval[] = [
    { kind: "booking", start: ist("2026-09-29T10:00:00"), end: ist("2026-09-29T11:00:00"), status: "approved" },
    { kind: "booking", start: ist("2026-09-29T12:00:00"), end: ist("2026-09-29T13:00:00"), status: "pending" },
    { kind: "maintenance", start: ist("2026-09-30T00:00:00"), end: ist("2026-10-01T00:00:00") },
  ];

  it("draws your own held booking once, as yours, and everyone else's as busy", () => {
    const events = weekEvents(busy, [booking({})]);
    expect(events.mine.map((m) => m.id)).toEqual(["b1"]);
    expect(events.others.map((o) => o.start.toISOString())).toEqual([ist("2026-09-29T12:00:00")]);
    expect(events.maintenance).toHaveLength(1);
    expect(events.blocking).toHaveLength(3);
  });

  it("doesn't let a rejected booking of yours hide someone else's at the same time", () => {
    const events = weekEvents(busy, [booking({ status: "rejected" })]);
    expect(events.others).toHaveLength(2);
    expect(events.mine[0]?.status).toBe("rejected");
  });

  it("leaves out cancelled bookings", () => {
    expect(weekEvents([], [booking({ status: "cancelled" })]).mine).toEqual([]);
  });

  it("describes a cell for screen readers", () => {
    const events = weekEvents(busy, [booking({})]);
    const cell = (from: string, to: string) => ({ start: new Date(ist(from)), end: new Date(ist(to)) });
    expect(describeCell(cell("2026-09-29T10:00:00", "2026-09-29T10:30:00"), events, true)).toBe("your booking, Lab, approved");
    expect(describeCell(cell("2026-09-29T12:30:00", "2026-09-29T13:00:00"), events, true)).toBe("busy");
    expect(describeCell(cell("2026-09-30T09:00:00", "2026-09-30T09:30:00"), events, true)).toBe("maintenance");
    expect(describeCell(cell("2026-09-29T11:00:00", "2026-09-29T11:30:00"), events, false)).toBe("free");
    expect(describeCell(cell("2026-09-29T11:00:00", "2026-09-29T11:30:00"), events, true)).toBe("unavailable");
  });
});

describe("isOpen", () => {
  const hours = { businessHoursStart: "08:00", businessHoursEnd: "18:00", businessDays: [1, 2, 3, 4, 5] };
  it("is inside business hours on business days only", () => {
    expect(isOpen("2026-09-28", 8 * 60, hours)).toBe(true);
    expect(isOpen("2026-09-28", 18 * 60, hours)).toBe(false);
    expect(isOpen("2026-09-28", 7 * 60 + 30, hours)).toBe(false);
    expect(isOpen("2026-10-03", 10 * 60, hours)).toBe(false); // Saturday
  });
});

describe("submit attempts", () => {
  let n = 0;
  const newKey = () => `key-${++n}`;

  it("keeps the key for the same request and replaces it for a changed one", () => {
    const first = nextAttempt(null, attemptSignature({ a: 1 }), newKey);
    expect(nextAttempt(first, attemptSignature({ a: 1 }), newKey)).toBe(first);
    expect(nextAttempt(first, attemptSignature({ a: 2 }), newKey).key).not.toBe(first.key);
  });

  it("treats network failures and server errors as unknown outcomes, rule failures as answers", () => {
    expect(outcomeUnknown(new ApiError(0, "NETWORK", ""))).toBe(true);
    expect(outcomeUnknown(new ApiError(502, "HTTP_ERROR", ""))).toBe(true);
    expect(outcomeUnknown(new ApiError(201, "BAD_RESPONSE", ""))).toBe(true);
    expect(outcomeUnknown(new Error("?"))).toBe(true);
    expect(outcomeUnknown(new ApiError(409, "SLOT_CONFLICT", ""))).toBe(false);
    expect(outcomeUnknown(new ApiError(422, "SLOT_TOO_LONG", ""))).toBe(false);
  });
});
