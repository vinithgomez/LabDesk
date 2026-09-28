import { describe, expect, it } from "vitest";
import { bookingReason, canCancel, displayStatus, needsDetail, pastWindow, splitByTime } from "./reasons";
import type { Booking, BookingDetail } from "./types";

const booking = (over: Partial<Booking>): Booking => ({
  id: "b1",
  resourceId: "r1",
  userId: "u1",
  start: "2026-09-29T04:30:00.000Z",
  end: "2026-09-29T05:30:00.000Z",
  status: "approved",
  purpose: "",
  attendeeCount: 1,
  seriesId: null,
  cancelledByMaintenanceId: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});
const detail = (over: Partial<BookingDetail>): BookingDetail => ({
  ...booking({}),
  approvals: [],
  awaitingLevel: null,
  cancellation: null,
  ...over,
});

describe("bookingReason", () => {
  it("reads a maintenance cancellation from the detail", () => {
    const reason = bookingReason(
      detail({
        status: "cancelled",
        cancellation: {
          kind: "maintenance",
          message: "Cancelled automatically",
          maintenance: { id: "m1", start: "2026-09-29T04:00:00.000Z", end: "2026-09-29T08:00:00.000Z", reason: "Rewiring" },
        },
      }),
    );
    expect(reason).toEqual({
      kind: "maintenance",
      start: new Date("2026-09-29T04:00:00.000Z"),
      end: new Date("2026-09-29T08:00:00.000Z"),
      reason: "Rewiring",
    });
  });

  it("calls a rejection nobody made an expiry", () => {
    const partlyApproved = detail({
      status: "rejected",
      approvals: [{ level: 1, approverId: "a", decision: "approved", comment: "", decidedAt: "" }],
    });
    expect(bookingReason(partlyApproved)).toEqual({ kind: "expired" });
    expect(bookingReason(detail({ status: "rejected" }))).toEqual({ kind: "expired" });
    expect(displayStatus(partlyApproved, { kind: "expired" })).toBe("expired");
  });

  it("keeps a real rejection, with its level and comment", () => {
    const rejected = detail({
      status: "rejected",
      approvals: [
        { level: 1, approverId: "a", decision: "approved", comment: "", decidedAt: "" },
        { level: 2, approverId: "b", decision: "rejected", comment: "Clashes with exams", decidedAt: "" },
      ],
    });
    const reason = bookingReason(rejected);
    expect(reason).toEqual({ kind: "rejected", level: 2, comment: "Clashes with exams" });
    expect(displayStatus(rejected, reason)).toBe("rejected");
  });

  it("has nothing to say about an ordinary booking", () => {
    expect(bookingReason(detail({ status: "approved" }))).toBeNull();
    expect(bookingReason(detail({ status: "cancelled" }))).toBeNull(); // the booker's own cancellation
  });

  it("fetches details only where a reason may exist", () => {
    expect(needsDetail(booking({ status: "rejected" }))).toBe(true);
    expect(needsDetail(booking({ status: "cancelled", cancelledByMaintenanceId: "m1" }))).toBe(true);
    expect(needsDetail(booking({ status: "cancelled" }))).toBe(false);
    expect(needsDetail(booking({ status: "approved" }))).toBe(false);
  });
});

describe("tabs", () => {
  const now = new Date("2026-09-29T05:00:00.000Z");

  it("keeps a booking in progress upcoming and an ended one past, without duplicates", () => {
    const running = booking({ id: "running" });
    const ended = booking({ id: "ended", start: "2026-09-28T04:00:00.000Z", end: "2026-09-29T05:00:00.000Z" });
    const older = booking({ id: "older", start: "2026-09-20T04:00:00.000Z", end: "2026-09-20T05:00:00.000Z" });
    const later = booking({ id: "later", start: "2026-10-01T04:00:00.000Z", end: "2026-10-01T05:00:00.000Z" });
    const split = splitByTime([later, running, older, ended, running], now);
    expect(split.upcoming.map((b) => b.id)).toEqual(["running", "later"]);
    expect(split.past.map((b) => b.id)).toEqual(["ended", "older"]);
  });

  it("walks the past back in 30-day windows", () => {
    expect(pastWindow(0, now)).toEqual({ from: new Date("2026-08-30T05:00:00.000Z"), to: now });
    expect(pastWindow(1, now)).toEqual({ from: new Date("2026-07-31T05:00:00.000Z"), to: new Date("2026-08-30T05:00:00.000Z") });
  });

  it("lets the booker cancel only before check-in", () => {
    expect(canCancel("pending")).toBe(true);
    expect(canCancel("approved")).toBe(true);
    expect(canCancel("checked_in")).toBe(false);
    expect(canCancel("completed")).toBe(false);
    expect(canCancel("rejected")).toBe(false);
  });
});
