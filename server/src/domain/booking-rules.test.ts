import { describe, expect, it } from "vitest";
import { assertBookableSlot, istDate, type SlotRules } from "./booking-rules.js";
import { DomainError } from "./errors.js";

const rules: SlotRules = { capacity: 10, minSlotMinutes: 30, maxSlotMinutes: 120, bookingHorizonDays: 7 };
const NOW = new Date("2026-09-23T06:30:00Z"); // 12:00 IST

const codeOf = (startsAt: string, endsAt: string, attendeeCount = 1): string | null => {
  try {
    assertBookableSlot(rules, { startsAt: new Date(startsAt), endsAt: new Date(endsAt), attendeeCount }, NOW);
    return null;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
};

describe("istDate", () => {
  it("uses the IST calendar, not UTC", () => {
    expect(istDate(new Date("2026-09-23T18:29:59Z"))).toBe("2026-09-23"); // 23:59:59 IST
    expect(istDate(new Date("2026-09-23T18:30:00Z"))).toBe("2026-09-24"); // 00:00 IST next day
  });
});

describe("assertBookableSlot", () => {
  it("accepts a valid slot, including one ending exactly at IST midnight", () => {
    expect(codeOf("2026-09-24T10:00:00+05:30", "2026-09-24T11:00:00+05:30")).toBeNull();
    expect(codeOf("2026-09-24T23:00:00+05:30", "2026-09-25T00:00:00+05:30")).toBeNull();
  });

  it("rejects slots crossing IST midnight even when they are same-day in UTC", () => {
    // 2026-09-24 23:30 IST -> 2026-09-25 00:30 IST is 18:00Z -> 19:00Z on one UTC day.
    expect(codeOf("2026-09-24T23:30:00+05:30", "2026-09-25T00:30:00+05:30")).toBe("MULTI_DAY_NOT_SUPPORTED");
  });

  it("allows a slot that spans two UTC days but one IST day", () => {
    // 2026-09-24 03:00-06:30 IST = 2026-09-23 21:30Z -> 2026-09-24 01:00Z
    expect(codeOf("2026-09-24T04:00:00+05:30", "2026-09-24T06:00:00+05:30")).toBeNull();
  });

  it("enforces slot length bounds inclusively", () => {
    expect(codeOf("2026-09-24T10:00:00+05:30", "2026-09-24T12:00:00+05:30")).toBeNull(); // exactly 120
    expect(codeOf("2026-09-24T10:00:00+05:30", "2026-09-24T12:01:00+05:30")).toBe("SLOT_TOO_LONG");
    expect(codeOf("2026-09-24T10:00:00+05:30", "2026-09-24T10:30:00+05:30")).toBeNull(); // exactly 30
    expect(codeOf("2026-09-24T10:00:00+05:30", "2026-09-24T10:29:00+05:30")).toBe("SLOT_TOO_SHORT");
  });

  it("rejects the past and anything ending beyond the horizon", () => {
    expect(codeOf("2026-09-23T11:00:00+05:30", "2026-09-23T12:30:00+05:30")).toBe("OUTSIDE_HORIZON");
    // NOW + 7 days = 2026-09-30 12:00 IST
    expect(codeOf("2026-09-30T11:00:00+05:30", "2026-09-30T12:00:00+05:30")).toBeNull();
    expect(codeOf("2026-09-30T11:30:00+05:30", "2026-09-30T12:30:00+05:30")).toBe("OUTSIDE_HORIZON");
  });

  it("checks attendees against capacity, treating capacity 0 as unlimited", () => {
    expect(codeOf("2026-09-24T10:00:00+05:30", "2026-09-24T11:00:00+05:30", 10)).toBeNull();
    expect(codeOf("2026-09-24T10:00:00+05:30", "2026-09-24T11:00:00+05:30", 11)).toBe("CAPACITY_EXCEEDED");
    expect(() =>
      assertBookableSlot(
        { ...rules, capacity: 0 },
        { startsAt: new Date("2026-09-24T10:00:00+05:30"), endsAt: new Date("2026-09-24T11:00:00+05:30"), attendeeCount: 500 },
        NOW,
      ),
    ).not.toThrow();
  });
});
