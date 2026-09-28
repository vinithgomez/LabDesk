import { describe, expect, it } from "vitest";
import {
  addDays,
  blockedSlots,
  clampDrag,
  clipToDay,
  crossesIstMidnight,
  defaultEnd,
  durationToHeight,
  endOptions,
  eventBox,
  gridRange,
  istDayEnd,
  istDayKey,
  istDayStart,
  istMinuteOfDay,
  istWeekStart,
  moveCell,
  nextWholeMinute,
  normalizeDrag,
  parseHhmm,
  pxToSlot,
  selectionFromSpan,
  slotCount,
  slotEnd,
  slotStart,
  slotToPx,
  weekDays,
  weekday,
  type GridRange,
} from "./grid";

// The suite runs with TZ=America/New_York (vitest.config.ts), so any use of
// the machine's local zone instead of IST shows up as a wrong answer here.
const ist = (local: string) => new Date(`${local}+05:30`);
const OFFICE: GridRange = { startMinute: 8 * 60, endMinute: 18 * 60 };
const ALL_DAY: GridRange = { startMinute: 0, endMinute: 24 * 60 };
const MON = "2026-09-28"; // a Monday

describe("IST days", () => {
  it("puts the last second before IST midnight on the earlier date", () => {
    expect(istDayKey(ist("2026-09-28T23:59:59"))).toBe("2026-09-28");
    expect(istDayKey(ist("2026-09-29T00:00:00"))).toBe("2026-09-29");
  });

  it("uses the IST date even where the local date differs", () => {
    // 01:00 IST on the 29th is still the afternoon of the 28th in New York.
    expect(istDayKey(new Date("2026-09-28T19:30:00Z"))).toBe("2026-09-29");
  });

  it("starts and ends a day at IST midnight", () => {
    expect(istDayStart(MON).toISOString()).toBe("2026-09-27T18:30:00.000Z");
    expect(istDayEnd(MON).toISOString()).toBe("2026-09-28T18:30:00.000Z");
  });

  it("does calendar arithmetic across month and year ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("numbers weekdays from Sunday, like businessDays", () => {
    expect(weekday(MON)).toBe(1);
    expect(weekday("2026-10-04")).toBe(0);
  });

  it("starts the week on the IST Monday", () => {
    expect(istWeekStart(ist("2026-10-01T12:00:00"))).toBe(MON);
    expect(istWeekStart(ist("2026-10-04T23:59:59"))).toBe(MON); // Sunday night
    expect(istWeekStart(ist("2026-10-05T00:00:00"))).toBe("2026-10-05"); // Monday midnight
    expect(istWeekStart(ist(`${MON}T00:00:00`))).toBe(MON);
  });

  it("lists Monday to Sunday across a month end", () => {
    expect(weekDays(MON)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("measures minutes from IST midnight", () => {
    expect(istMinuteOfDay(ist(`${MON}T00:00:00`))).toBe(0);
    expect(istMinuteOfDay(ist(`${MON}T09:30:00`))).toBe(570);
    expect(istMinuteOfDay(ist(`${MON}T23:59:00`))).toBe(1439);
  });

  it("treats a booking ending exactly at IST midnight as same-day", () => {
    expect(crossesIstMidnight(ist(`${MON}T23:00:00`), ist("2026-09-29T00:00:00"))).toBe(false);
    expect(crossesIstMidnight(ist(`${MON}T00:00:00`), ist(`${MON}T01:00:00`))).toBe(false);
  });

  it("rejects a selection crossing midnight IST", () => {
    expect(crossesIstMidnight(ist(`${MON}T23:30:00`), ist("2026-09-29T00:30:00"))).toBe(true);
    // 23:00–00:30 IST is one UTC day (17:30Z–19:00Z) but two IST days.
    expect(crossesIstMidnight(new Date("2026-09-28T17:30:00Z"), new Date("2026-09-28T19:00:00Z"))).toBe(true);
  });
});

describe("gridRange", () => {
  it("uses the business hours", () => {
    expect(gridRange({ start: "08:00", end: "18:00" }, [], [MON])).toEqual(OFFICE);
  });

  it("rounds odd business hours out to whole rows", () => {
    expect(gridRange({ start: "08:15", end: "17:45" }, [], [MON])).toEqual(OFFICE);
    expect(gridRange({ start: "08:30", end: "17:30" }, [], [MON])).toEqual({ startMinute: 510, endMinute: 1050 });
  });

  it("covers the whole day for 00:00–23:59", () => {
    expect(gridRange({ start: "00:00", end: "23:59" }, [], [MON])).toEqual(ALL_DAY);
  });

  it("widens to show an event outside the hours", () => {
    const late = { start: ist(`${MON}T19:00:00`), end: ist(`${MON}T20:15:00`) };
    expect(gridRange({ start: "08:00", end: "18:00" }, [late], [MON])).toEqual({ startMinute: 480, endMinute: 1230 });
  });

  it("ignores events on days not shown", () => {
    const early = { start: ist("2026-10-05T06:00:00"), end: ist("2026-10-05T07:00:00") };
    expect(gridRange({ start: "08:00", end: "18:00" }, [early], [MON])).toEqual(OFFICE);
  });

  it("widens to midnight for a window running overnight into a shown day", () => {
    const overnight = { start: ist("2026-09-27T22:00:00"), end: ist(`${MON}T09:00:00`) };
    expect(gridRange({ start: "08:00", end: "18:00" }, [overnight], [MON])).toEqual({ startMinute: 0, endMinute: 1080 });
  });

  it("parses HH:MM", () => {
    expect(parseHhmm("00:00")).toBe(0);
    expect(parseHhmm("23:59")).toBe(1439);
  });
});

describe("pixels", () => {
  it("maps rows and durations to pixels", () => {
    expect(slotCount(OFFICE)).toBe(20);
    expect(slotToPx(0)).toBe(0);
    expect(slotToPx(3)).toBe(72);
    expect(durationToHeight(30)).toBe(24);
    expect(durationToHeight(45)).toBe(36);
    expect(durationToHeight(120)).toBe(96);
  });

  it("finds the row under a pointer, on half-hour boundaries", () => {
    expect(pxToSlot(0, OFFICE)).toBe(0);
    expect(pxToSlot(23.9, OFFICE)).toBe(0);
    expect(pxToSlot(24, OFFICE)).toBe(1);
    expect(pxToSlot(-5, OFFICE)).toBe(0);
    expect(pxToSlot(10_000, OFFICE)).toBe(19);
  });

  it("places an event relative to the first visible row", () => {
    const box = eventBox({ start: ist(`${MON}T09:00:00`), end: ist(`${MON}T10:30:00`) }, MON, OFFICE);
    expect(box).toEqual({ top: 24 * 2, height: 24 * 3 });
  });

  it("clips an event to the visible hours", () => {
    const box = eventBox({ start: ist(`${MON}T07:00:00`), end: ist(`${MON}T09:00:00`) }, MON, OFFICE);
    expect(box).toEqual({ top: 0, height: 48 });
    expect(eventBox({ start: ist(`${MON}T18:00:00`), end: ist(`${MON}T19:00:00`) }, MON, OFFICE)).toBeNull();
  });

  it("draws a block ending at midnight to the bottom edge of the day", () => {
    const box = eventBox({ start: ist(`${MON}T23:00:00`), end: ist("2026-09-29T00:00:00") }, MON, ALL_DAY);
    expect(box).toEqual({ top: 46 * 24, height: 48 });
  });

  it("splits a multi-day maintenance window across its days", () => {
    const window = { start: ist(`${MON}T22:00:00`), end: ist("2026-09-29T02:00:00") };
    expect(eventBox(window, MON, ALL_DAY)).toEqual({ top: 44 * 24, height: 96 });
    expect(eventBox(window, "2026-09-29", ALL_DAY)).toEqual({ top: 0, height: 96 });
    expect(eventBox(window, "2026-09-30", ALL_DAY)).toBeNull();
    expect(clipToDay(window, "2026-09-29")?.start.toISOString()).toBe(istDayStart("2026-09-29").toISOString());
  });
});

describe("slots and drags", () => {
  it("gives each row its IST start and end", () => {
    expect(slotStart(MON, OFFICE, 0)).toEqual(ist(`${MON}T08:00:00`));
    expect(slotEnd(MON, OFFICE, 19)).toEqual(ist(`${MON}T18:00:00`));
    expect(slotEnd(MON, ALL_DAY, 47)).toEqual(ist("2026-09-29T00:00:00"));
  });

  it("normalises a drag made upwards", () => {
    expect(normalizeDrag(5, 2)).toEqual({ first: 2, last: 5 });
    expect(normalizeDrag(2, 5)).toEqual({ first: 2, last: 5 });
    expect(normalizeDrag(4, 4)).toEqual({ first: 4, last: 4 });
  });

  it("stops a drag before the first blocked row, in either direction", () => {
    const blocked = [false, false, true, false, false];
    expect(clampDrag(0, 4, blocked)).toEqual({ first: 0, last: 1 });
    expect(clampDrag(4, 0, blocked)).toEqual({ first: 3, last: 4 });
    expect(clampDrag(4, 3, blocked)).toEqual({ first: 3, last: 4 });
    expect(clampDrag(2, 4, blocked)).toBeNull();
  });

  it("blocks rows that are over or busy, but not the row under way", () => {
    const now = ist(`${MON}T09:10:00`);
    const busy = [{ start: ist(`${MON}T10:00:00`), end: ist(`${MON}T11:00:00`) }];
    const blocked = blockedSlots(MON, OFFICE, busy, now);
    expect(blocked.slice(0, 7)).toEqual([true, true, false, false, true, true, false]);
  });

  it("blocks the row under way once its last minute has started", () => {
    const blocked = blockedSlots(MON, OFFICE, [], ist(`${MON}T09:29:30`));
    expect(blocked[2]).toBe(true);
    expect(blocked[3]).toBe(false);
  });

  it("starts a selection in the row under way at the next whole minute", () => {
    const now = ist(`${MON}T09:10:30`);
    expect(nextWholeMinute(now)).toEqual(ist(`${MON}T09:11:00`));
    expect(nextWholeMinute(ist(`${MON}T09:10:00`))).toEqual(ist(`${MON}T09:11:00`));
    expect(selectionFromSpan(MON, OFFICE, { first: 2, last: 3 }, now)).toEqual({
      start: ist(`${MON}T09:11:00`),
      end: ist(`${MON}T10:00:00`),
    });
  });

  it("keeps a future selection on row boundaries", () => {
    expect(selectionFromSpan(MON, OFFICE, { first: 4, last: 5 }, ist(`${MON}T07:00:00`))).toEqual({
      start: ist(`${MON}T10:00:00`),
      end: ist(`${MON}T11:00:00`),
    });
  });

  it("returns nothing for a selection that is already over", () => {
    expect(selectionFromSpan(MON, OFFICE, { first: 0, last: 0 }, ist(`${MON}T09:00:00`))).toBeNull();
  });
});

describe("endOptions", () => {
  const rules = { minSlotMinutes: 60, maxSlotMinutes: 120, latestEnd: ist("2026-10-28T00:00:00") };
  const free = Array<boolean>(48).fill(false);

  it("offers row boundaries within the minimum and maximum length", () => {
    const options = endOptions(MON, OFFICE, ist(`${MON}T09:00:00`), free, rules);
    expect(options).toEqual([ist(`${MON}T10:00:00`), ist(`${MON}T10:30:00`), ist(`${MON}T11:00:00`)]);
  });

  it("stops before a blocked row", () => {
    const blocked = [...free];
    blocked[5] = true; // 10:30–11:00
    expect(endOptions(MON, OFFICE, ist(`${MON}T09:00:00`), blocked, rules)).toEqual([
      ist(`${MON}T10:00:00`),
      ist(`${MON}T10:30:00`),
    ]);
  });

  it("stops at the booking horizon", () => {
    const soon = { ...rules, latestEnd: ist(`${MON}T10:00:00`) };
    expect(endOptions(MON, OFFICE, ist(`${MON}T09:00:00`), free, soon)).toEqual([ist(`${MON}T10:00:00`)]);
  });

  it("measures from an off-boundary start", () => {
    const short = { ...rules, minSlotMinutes: 15 };
    expect(endOptions(MON, OFFICE, ist(`${MON}T09:11:00`), free, short).slice(0, 2)).toEqual([
      ist(`${MON}T09:30:00`),
      ist(`${MON}T10:00:00`),
    ]);
  });

  it("never runs past IST midnight", () => {
    const options = endOptions(MON, ALL_DAY, ist(`${MON}T23:00:00`), free, rules);
    expect(options).toEqual([ist("2026-09-29T00:00:00")]);
  });

  it("offers nothing when the resource's minimum doesn't fit", () => {
    const blocked = [...free];
    blocked[3] = true;
    expect(endOptions(MON, OFFICE, ist(`${MON}T09:00:00`), blocked, rules)).toEqual([]);
  });

  it("defaults to the dragged end, else the nearest shorter option, else the shortest", () => {
    const options = [ist(`${MON}T10:00:00`), ist(`${MON}T10:30:00`), ist(`${MON}T11:00:00`)];
    expect(defaultEnd(options, ist(`${MON}T10:30:00`))).toEqual(options[1]);
    expect(defaultEnd(options, ist(`${MON}T12:00:00`))).toEqual(options[2]);
    expect(defaultEnd(options, ist(`${MON}T09:30:00`))).toEqual(options[0]);
    expect(defaultEnd([], ist(`${MON}T09:30:00`))).toBeNull();
  });
});

describe("moveCell", () => {
  it("moves by row and by day, staying inside the grid", () => {
    expect(moveCell({ day: 0, slot: 0 }, "ArrowUp", 20)).toEqual({ day: 0, slot: 0 });
    expect(moveCell({ day: 0, slot: 0 }, "ArrowDown", 20)).toEqual({ day: 0, slot: 1 });
    expect(moveCell({ day: 6, slot: 19 }, "ArrowDown", 20)).toEqual({ day: 6, slot: 19 });
    expect(moveCell({ day: 6, slot: 3 }, "ArrowRight", 20)).toEqual({ day: 6, slot: 3 });
    expect(moveCell({ day: 0, slot: 3 }, "ArrowLeft", 20)).toEqual({ day: 0, slot: 3 });
    expect(moveCell({ day: 2, slot: 3 }, "Home", 20)).toEqual({ day: 2, slot: 0 });
    expect(moveCell({ day: 2, slot: 3 }, "End", 20)).toEqual({ day: 2, slot: 19 });
    expect(moveCell({ day: 2, slot: 3 }, "a", 20)).toBeNull();
  });
});
