import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { API_ERROR_CODES, describeApiError, formatDuration } from "./api-errors";

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
