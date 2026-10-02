import { describe, expect, it } from "vitest";
import type { BusyInterval } from "../bookings/types";
import {
  formatSpan,
  instantToIstInput,
  istInputToInstant,
  maintenanceWarning,
  overlappingBookings,
  validateIncident,
  validateMaintenance,
} from "./maintenance";

// Runs with TZ=America/New_York: inputs must still be read as IST.
const ist = (local: string) => new Date(`${local}+05:30`);
const NOW = ist("2026-10-05T09:00:00");

describe("IST date-time inputs", () => {
  it("reads a datetime-local value as IST, not the browser's zone", () => {
    expect(istInputToInstant("2026-10-05T10:00")).toEqual(ist("2026-10-05T10:00:00"));
    expect(istInputToInstant("2026-10-05T00:00")?.toISOString()).toBe("2026-10-04T18:30:00.000Z");
  });

  it("writes an instant back as IST wall-clock text", () => {
    expect(instantToIstInput(new Date("2026-10-04T18:30:00.000Z"))).toBe("2026-10-05T00:00");
  });

  it("rejects malformed and impossible values", () => {
    expect(istInputToInstant("")).toBeNull();
    expect(istInputToInstant("2026-10-05 10:00")).toBeNull();
    expect(istInputToInstant("2026-02-30T10:00")).toBeNull();
    expect(istInputToInstant("2026-10-05T24:00")).toBeNull();
  });

  it("shows a same-day window compactly and a multi-day one in full", () => {
    expect(formatSpan(ist("2026-10-05T10:00:00"), ist("2026-10-05T12:00:00"))).toBe("Mon 5 Oct, 10:00–12:00");
    expect(formatSpan(ist("2026-10-05T22:00:00"), ist("2026-10-06T06:00:00"))).toBe("Mon 5 Oct, 22:00 – Tue 6 Oct, 06:00");
    expect(formatSpan(ist("2026-10-05T22:00:00"), ist("2026-10-06T00:00:00"))).toBe("Mon 5 Oct, 22:00–00:00");
  });
});

describe("validateMaintenance", () => {
  const ok = { resourceId: "r1", start: "2026-10-05T10:00", end: "2026-10-05T12:00", reason: "Rewiring" };

  it("accepts a future window with a reason", () => {
    expect(validateMaintenance(ok, NOW)).toEqual({});
  });

  it("accepts a window already under way, as long as it ends in the future", () => {
    expect(validateMaintenance({ ...ok, start: "2026-10-05T08:00" }, NOW)).toEqual({});
  });

  it("refuses a missing resource, times and reason", () => {
    expect(Object.keys(validateMaintenance({ resourceId: "", start: "", end: "", reason: " " }, NOW)).sort()).toEqual([
      "end",
      "reason",
      "resourceId",
      "start",
    ]);
  });

  it("refuses an end at or before the start, and one already past", () => {
    expect(validateMaintenance({ ...ok, end: "2026-10-05T10:00" }, NOW).end).toBe("It must end after it starts.");
    expect(validateMaintenance({ ...ok, start: "2026-10-05T07:00", end: "2026-10-05T09:00" }, NOW).end).toBe("It must end in the future.");
  });
});

describe("overlap preview and warning", () => {
  const busy: BusyInterval[] = [
    { kind: "booking", start: ist("2026-10-05T09:00:00").toISOString(), end: ist("2026-10-05T10:00:00").toISOString(), status: "approved" },
    { kind: "booking", start: ist("2026-10-05T11:00:00").toISOString(), end: ist("2026-10-05T12:00:00").toISOString(), status: "pending" },
    { kind: "maintenance", start: ist("2026-10-05T10:30:00").toISOString(), end: ist("2026-10-05T11:00:00").toISOString() },
  ];

  it("counts held bookings that overlap, touching edges excluded", () => {
    expect(overlappingBookings(busy, ist("2026-10-05T10:00:00"), ist("2026-10-05T11:00:00"))).toBe(0);
    expect(overlappingBookings(busy, ist("2026-10-05T09:30:00"), ist("2026-10-05T11:30:00"))).toBe(2);
  });

  it("says plainly that overlapping bookings will be cancelled", () => {
    const text = maintenanceWarning("Systems Lab", ist("2026-10-05T10:00:00"), ist("2026-10-05T12:00:00"), 2);
    expect(text).toBe(
      "Every booking on Systems Lab that overlaps Mon 5 Oct, 10:00–12:00 (pending, approved or in progress) will be cancelled automatically, and its booker will see your reason. 2 bookings overlap it right now.",
    );
    expect(maintenanceWarning("X", NOW, ist("2026-10-05T10:00:00"), 1)).toMatch(/1 booking overlaps it right now\.$/);
    expect(maintenanceWarning("X", NOW, ist("2026-10-05T10:00:00"), 0)).toMatch(/No bookings overlap it right now\.$/);
    expect(maintenanceWarning("X", NOW, ist("2026-10-05T10:00:00"), null)).toMatch(/will see your reason\.$/);
  });
});

describe("validateIncident", () => {
  it("needs a resource and a description", () => {
    expect(validateIncident({ resourceId: "r1", description: "Projector bulb gone" })).toEqual({});
    expect(Object.keys(validateIncident({ resourceId: "", description: "  " })).sort()).toEqual(["description", "resourceId"]);
  });
});
