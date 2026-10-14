import { describe, expect, it } from "vitest";
import type { BusyInterval } from "../bookings/types";
import { todaySummary } from "./today";

// Runs with TZ=America/New_York: everything must still be read in IST.
const ist = (local: string) => new Date(`${local}+05:30`);
const at = (hhmm: string) => ist(`2026-10-14T${hhmm}:00`); // a Wednesday
const booking = (from: string, to: string): BusyInterval => ({
  kind: "booking",
  start: at(from).toISOString(),
  end: at(to).toISOString(),
  status: "approved",
});
const maintenance = (from: string, to: string): BusyInterval => ({ kind: "maintenance", start: from, end: to });
const OFFICE = { businessHoursStart: "08:00", businessHoursEnd: "18:00", businessDays: [1, 2, 3, 4, 5] };

describe("todaySummary", () => {
  it("is free until the next booking, or for the rest of the day", () => {
    expect(todaySummary([booking("14:00", "15:00")], OFFICE, at("10:00"))).toEqual({ state: "free", label: "Free until 14:00" });
    expect(todaySummary([], OFFICE, at("10:00"))).toEqual({ state: "free", label: "Free for the rest of the day" });
    // A booking that already ended doesn't count.
    expect(todaySummary([booking("08:00", "09:00")], OFFICE, at("10:00")).label).toBe("Free for the rest of the day");
  });

  it("is in use until the booking ends, joining back-to-back bookings", () => {
    expect(todaySummary([booking("09:30", "11:30")], OFFICE, at("10:00"))).toEqual({ state: "in-use", label: "In use until 11:30" });
    expect(todaySummary([booking("09:30", "11:00"), booking("11:00", "12:30")], OFFICE, at("10:00")).label).toBe("In use until 12:30");
    // The end is exclusive: at 11:30 it's free again.
    expect(todaySummary([booking("09:30", "11:30")], OFFICE, at("11:30")).state).toBe("free");
  });

  it("puts maintenance first, even on a closed day", () => {
    const m = maintenance(at("09:00").toISOString(), at("16:00").toISOString());
    expect(todaySummary([m, booking("10:00", "11:00")], OFFICE, at("10:30"))).toEqual({
      state: "maintenance",
      label: "Maintenance until 16:00",
    });
    const multiDay = maintenance(at("09:00").toISOString(), ist("2026-10-16T12:00:00").toISOString());
    expect(todaySummary([multiDay], OFFICE, at("10:30")).label).toBe("Maintenance until later than today");
  });

  it("says when it opens, and when it's closed", () => {
    expect(todaySummary([], OFFICE, at("07:15"))).toEqual({ state: "opens-later", label: "Opens at 08:00" });
    expect(todaySummary([], OFFICE, at("18:00"))).toEqual({ state: "closed", label: "Closed for the day" });
    const saturday = ist("2026-10-17T10:00:00");
    expect(todaySummary([], OFFICE, saturday)).toEqual({ state: "closed", label: "Closed today" });
  });

  it("uses the IST date, not the machine's", () => {
    // 00:30 IST Thursday is still Wednesday evening in New York.
    const earlyThursday = ist("2026-10-15T00:30:00");
    const allDay = { businessHoursStart: "00:00", businessHoursEnd: "23:59", businessDays: [4] };
    expect(todaySummary([], allDay, earlyThursday).state).toBe("free");
  });
});
