import { describe, expect, it } from "vitest";
import {
  approvalErrorContext,
  availableActions,
  decisionSummary,
  isLapsed,
  rejectionCommentError,
  whyNotDecidable,
  type InboxItem,
} from "./model";

const ME = "me";
const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "b1",
  resourceId: "r1",
  userId: "u-booker",
  start: "2026-10-05T04:30:00.000Z", // Mon 5 Oct 10:00 IST
  end: "2026-10-05T05:30:00.000Z",
  status: "pending",
  purpose: "Lab practical",
  attendeeCount: 12,
  seriesId: null,
  cancelledByMaintenanceId: null,
  createdAt: "",
  updatedAt: "",
  approvals: [],
  awaitingLevel: 1,
  booker: { id: "u-booker", fullName: "Priya Nair" },
  resource: { id: "r1", name: "Systems Lab" },
  awaitingSince: "",
  stalled: false,
  lapsed: false,
  canDecide: true,
  ...over,
});
const before = new Date("2026-10-05T04:00:00.000Z");
const after = new Date("2026-10-05T04:31:00.000Z");

describe("availableActions", () => {
  it("offers approve and reject before the start", () => {
    expect(availableActions(item(), before)).toEqual({ approve: true, reject: true });
  });

  it("withholds approve once lapsed, by the server's flag or the clock", () => {
    expect(availableActions(item({ lapsed: true }), before)).toEqual({ approve: false, reject: true });
    expect(availableActions(item(), after)).toEqual({ approve: false, reject: true });
    expect(isLapsed(item(), new Date("2026-10-05T04:30:00.000Z"))).toBe(true); // exactly at the start
  });

  it("offers nothing on an item the caller can't decide", () => {
    expect(availableActions(item({ canDecide: false }), before)).toEqual({ approve: false, reject: false });
  });
});

describe("whyNotDecidable", () => {
  it("is null when the caller can decide", () => {
    expect(whyNotDecidable(item(), ME)).toBeNull();
  });

  it("explains own bookings, earlier decisions and other levels", () => {
    expect(whyNotDecidable(item({ canDecide: false, booker: { id: ME, fullName: "Me" } }), ME)).toBe(
      "Your own booking: someone else decides it.",
    );
    const decided = item({
      canDecide: false,
      awaitingLevel: 2,
      approvals: [{ level: 1, approverId: ME, approverName: "Me", decision: "approved", comment: "", decidedAt: "" }],
    });
    expect(whyNotDecidable(decided, ME)).toBe("You decided an earlier level; level 2 needs a different approver.");
    expect(whyNotDecidable(item({ canDecide: false, awaitingLevel: 2 }), ME)).toBe("Awaiting level 2, which isn't yours to decide.");
  });
});

describe("approvalErrorContext", () => {
  it("captures what the error sentence needs", () => {
    expect(approvalErrorContext(item({ awaitingLevel: 2 }), "approve", ME, after)).toEqual({
      action: "approve",
      ownBooking: false,
      decidedEarlierLevel: false,
      awaitingLevel: 2,
      lapsed: true,
    });
    const mine = item({ booker: { id: ME, fullName: "Me" } });
    expect(approvalErrorContext(mine, "reject", ME, before).ownBooking).toBe(true);
  });
});

describe("decisionSummary", () => {
  const when = "Mon 5 Oct, 10:00–11:00";
  it("reports a final approval, a partial one and a rejection", () => {
    expect(decisionSummary(item(), "approve", { status: "approved", awaitingLevel: null }, when)).toBe(
      "Approved: Systems Lab, Mon 5 Oct, 10:00–11:00, for Priya Nair.",
    );
    expect(decisionSummary(item(), "approve", { status: "pending", awaitingLevel: 2 }, when)).toBe(
      "Level 1 approved: Systems Lab, Mon 5 Oct, 10:00–11:00, for Priya Nair. It now awaits level 2.",
    );
    expect(decisionSummary(item(), "reject", { status: "rejected", awaitingLevel: null }, when)).toBe(
      "Rejected: Systems Lab, Mon 5 Oct, 10:00–11:00, for Priya Nair.",
    );
  });
});

describe("rejectionCommentError", () => {
  it("requires a non-blank reason", () => {
    expect(rejectionCommentError("")).not.toBeNull();
    expect(rejectionCommentError("   ")).not.toBeNull();
    expect(rejectionCommentError("Clashes with exams")).toBeNull();
  });
});
