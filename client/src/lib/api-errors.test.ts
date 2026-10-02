import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { API_ERROR_CODES, describeApiError, describeSkipReason, formatDuration } from "./api-errors";

const lab = { name: "Systems Lab", capacity: 40, minSlotMinutes: 60, maxSlotMinutes: 180, bookingHorizonDays: 14 };
const err = (code: string, message = "server says so", details?: unknown) => new ApiError(409, code, message, details);

describe("describeApiError", () => {
  it("has one sentence for every code, never the code itself", () => {
    for (const code of API_ERROR_CODES) {
      const sentence = describeApiError(err(code), { resource: lab });
      expect(sentence, code).toMatch(/^[A-Z].*\.$/);
      expect(sentence, code).not.toContain(code);
    }
  });

  it("covers every booking rule the calendar can break", () => {
    for (const code of [
      "SLOT_CONFLICT",
      "MULTI_DAY_NOT_SUPPORTED",
      "SLOT_TOO_LONG",
      "SLOT_TOO_SHORT",
      "OUTSIDE_HORIZON",
      "CAPACITY_EXCEEDED",
      "MAINTENANCE_BLOCKED",
      "WRONG_DEPARTMENT",
      "SLOT_AVAILABLE",
      "WAITLIST_DUPLICATE",
    ]) {
      expect(API_ERROR_CODES).toContain(code);
    }
  });

  it("states the actual limit that was broken", () => {
    expect(describeApiError(err("SLOT_TOO_LONG"), { resource: lab })).toBe(
      "That's too long: Systems Lab can be booked for at most 3 hours at a time.",
    );
    expect(describeApiError(err("SLOT_TOO_SHORT"), { resource: lab })).toBe(
      "That's too short: Systems Lab must be booked for at least 1 hour.",
    );
    expect(describeApiError(err("CAPACITY_EXCEEDED"), { resource: lab })).toBe("Too many people: Systems Lab holds at most 40.");
    expect(describeApiError(err("MAINTENANCE_BLOCKED"), { resource: lab })).toBe(
      "Systems Lab is closed for maintenance during that time.",
    );
    expect(describeApiError(err("WRONG_DEPARTMENT"), { resource: lab })).toContain("your own department");
    expect(describeApiError(err("MULTI_DAY_NOT_SUPPORTED"))).toBe("A booking has to start and end on the same day (India time).");
  });

  it("tells a past start from one too far ahead", () => {
    const now = new Date("2026-10-05T04:30:00Z");
    const past = { start: new Date("2026-10-05T04:00:00Z"), end: new Date("2026-10-05T05:00:00Z") };
    const far = { start: new Date("2026-11-05T04:00:00Z"), end: new Date("2026-11-05T05:00:00Z") };
    expect(describeApiError(err("OUTSIDE_HORIZON"), { resource: lab, period: past, now })).toBe(
      "That time has already started; bookings can't begin in the past.",
    );
    expect(describeApiError(err("OUTSIDE_HORIZON"), { resource: lab, period: far, now })).toBe(
      "That's too far ahead: Systems Lab can only be booked up to 14 days in advance.",
    );
  });

  it("falls back to the server's words when it lacks the numbers", () => {
    expect(describeApiError(err("SLOT_TOO_LONG", "This resource can be booked for at most 180 minutes at a time"))).toBe(
      "That's too long: This resource can be booked for at most 180 minutes at a time.",
    );
    expect(describeApiError(err("SOMETHING_NEW", "A brand-new rule."))).toBe("A brand-new rule.");
    expect(describeApiError(new Error("boom"))).toBe("Something went wrong; try again.");
  });

  it("names the field a validation error is about", () => {
    const e = err("VALIDATION_ERROR", "Request validation failed", [{ path: "attendeeCount", message: "Too small" }]);
    expect(describeApiError(e)).toBe("Some details weren't accepted (attendeeCount: Too small).");
  });
});

describe("formatDuration", () => {
  it.each([
    [1, "1 minute"],
    [30, "30 minutes"],
    [60, "1 hour"],
    [90, "1 h 30 min"],
    [180, "3 hours"],
  ])("%i -> %s", (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});

describe("approval refusals", () => {
  const base = { action: "approve" as "approve" | "reject", ownBooking: false, decidedEarlierLevel: false, awaitingLevel: 1, lapsed: false };
  const say = (code: string, approval: Partial<typeof base>, status = 403) =>
    describeApiError(new ApiError(status, code, "server wording"), { approval: { ...base, ...approval } });

  it("says it's your own booking", () => {
    expect(say("FORBIDDEN", { ownBooking: true })).toBe("You can't approve or reject your own booking.");
  });

  it("says which level it's awaiting", () => {
    expect(say("FORBIDDEN", { awaitingLevel: 2 })).toBe("This booking is awaiting level 2 approval, which isn't yours to decide.");
    expect(say("FORBIDDEN", { awaitingLevel: 1 })).toBe("This booking is awaiting level 1 approval, which isn't yours to decide.");
  });

  it("says you already decided an earlier level", () => {
    expect(say("FORBIDDEN", { decidedEarlierLevel: true, awaitingLevel: 2 })).toBe(
      "You already decided an earlier level of this booking; a different approver must decide level 2.",
    );
  });

  it("says approval is closed once the start has passed, but only for approving", () => {
    expect(say("INVALID_TRANSITION", { lapsed: true }, 409)).toBe(
      "Approval is closed: the booking's start time has passed, so it can only be rejected.",
    );
    expect(say("INVALID_TRANSITION", { lapsed: true, action: "reject" }, 409)).toBe(
      "This booking was already decided by someone else, or cancelled, before your decision arrived.",
    );
  });

  it("says it was already decided", () => {
    expect(say("INVALID_TRANSITION", {}, 409)).toBe(
      "This booking was already decided by someone else, or cancelled, before your decision arrived.",
    );
  });

  it("covers the department and visibility refusals, and falls back for anything else", () => {
    expect(say("WRONG_DEPARTMENT", {})).toBe("You can only decide bookings in your own department.");
    expect(say("NOT_FOUND", {}, 404)).toBe("This booking is no longer in your inbox; it may have been cancelled.");
    expect(say("NETWORK", {}, 0)).toBe("Couldn't reach LabDesk; check your connection and try again.");
  });

  it("never repeats the server's wording", () => {
    for (const code of ["FORBIDDEN", "INVALID_TRANSITION", "WRONG_DEPARTMENT", "NOT_FOUND"]) {
      expect(say(code, {})).not.toContain("server wording");
    }
  });
});

describe("admin refusals", () => {
  it("explains OWNER_REQUIRED and INVALID_BUSINESS_HOURS in plain words", () => {
    expect(describeApiError(err("OWNER_REQUIRED"))).toMatch(/at least one owner at each approval level/);
    expect(describeApiError(err("INVALID_BUSINESS_HOURS"))).toBe("The opening time must be earlier than the closing time.");
  });

  it("names why an owner isn't eligible", () => {
    const e = err("INVALID_OWNER", "One or more owners are not eligible", [{ userId: "u1", reason: "students cannot own resources" }]);
    expect(describeApiError(e)).toBe(
      "One of the chosen owners can't own this resource: students cannot own resources. Owners must be active staff in the resource's department, or admins.",
    );
  });

  it("explains a refused role change", () => {
    expect(describeApiError(new ApiError(403, "FORBIDDEN", "x"), { roleChange: { ownAccount: true } })).toBe(
      "You can't change your own role; another admin has to do it.",
    );
  });

  it("says INVALID_RRULE plainly", () => {
    expect(describeApiError(err("INVALID_RRULE"))).not.toContain("FREQ");
  });
});

describe("describeSkipReason", () => {
  it("has a sentence for each booking rule, and a fallback", () => {
    for (const code of ["SLOT_CONFLICT", "MAINTENANCE_BLOCKED", "OUTSIDE_HORIZON", "SLOT_TOO_LONG", "SLOT_TOO_SHORT", "MULTI_DAY_NOT_SUPPORTED", "CAPACITY_EXCEEDED", "FORBIDDEN", "SOMETHING_NEW"]) {
      expect(describeSkipReason(code), code).toMatch(/^[A-Z].*\.$/);
    }
    expect(describeSkipReason("SLOT_CONFLICT")).toBe("Someone else already had that time booked.");
  });
});
