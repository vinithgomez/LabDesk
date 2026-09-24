import { describe, expect, it } from "vitest";
import { DomainError } from "./errors.js";
import { formatWeeklyRule, nextOccurrence, occurrencesBetween, parseWeeklyRule } from "./rrule.js";

const iso = (d: Date) => d.toISOString();
const starts = (occ: { startsAt: Date }[]) => occ.map((o) => iso(o.startsAt));

// 2026-10-05 is a Monday. 09:00 IST = 03:30 UTC.
const MON = new Date("2026-10-05T00:00:00+05:30");

describe("parseWeeklyRule", () => {
  it("accepts the supported subset and normalizes it", () => {
    const rule = parseWeeklyRule("rrule:freq=weekly;byday=we,mo,we;until=20261231");
    expect(rule).toEqual({ byDay: ["MO", "WE"], until: { kind: "date", date: "2026-12-31" } });
    expect(formatWeeklyRule(rule)).toBe("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231");
  });

  it("accepts a UTC date-time UNTIL", () => {
    const rule = parseWeeklyRule("FREQ=WEEKLY;BYDAY=FR;UNTIL=20261030T120000Z");
    expect(rule.until).toEqual({ kind: "instant", at: new Date("2026-10-30T12:00:00Z") });
    expect(formatWeeklyRule(rule)).toBe("FREQ=WEEKLY;BYDAY=FR;UNTIL=20261030T120000Z");
  });

  it.each([
    ["FREQ=DAILY;BYDAY=MO;UNTIL=20261231", /FREQ=DAILY/],
    ["BYDAY=MO;UNTIL=20261231", /FREQ is required/],
    ["FREQ=WEEKLY;UNTIL=20261231", /BYDAY is required/],
    ["FREQ=WEEKLY;BYDAY=MO", /UNTIL is required/],
    ["FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231;INTERVAL=2", /INTERVAL/],
    ["FREQ=WEEKLY;BYDAY=MO;COUNT=5;UNTIL=20261231", /COUNT/],
    ["FREQ=WEEKLY;BYDAY=1MO;UNTIL=20261231", /BYDAY value "1MO"/],
    ["FREQ=WEEKLY;BYDAY=MO;UNTIL=20260230", /not a valid date/],
    ["FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T250000Z", /not a valid UTC date-time/],
    ["FREQ=WEEKLY;BYDAY=MO;UNTIL=2026-12-31", /YYYYMMDD/],
    ["FREQ=WEEKLY;FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231", /appears twice/],
    ["FREQ=WEEKLY;;BYDAY=MO;UNTIL=20261231", /Malformed/],
  ])("rejects %s", (text, message) => {
    let error: unknown;
    try {
      parseWeeklyRule(text);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "INVALID_RRULE", message: expect.stringMatching(message) });
  });
});

describe("occurrencesBetween", () => {
  const rule = parseWeeklyRule("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261021");

  it("yields each BYDAY at the IST start time, in order", () => {
    const occ = occurrencesBetween(rule, "09:00", 90, MON, new Date("2026-10-15T00:00:00+05:30"));
    expect(starts(occ)).toEqual(["2026-10-05T03:30:00.000Z", "2026-10-07T03:30:00.000Z", "2026-10-12T03:30:00.000Z", "2026-10-14T03:30:00.000Z"]);
    expect(iso(occ[0]!.endsAt)).toBe("2026-10-05T05:00:00.000Z");
  });

  it("treats a DATE UNTIL as inclusive of that IST day", () => {
    const occ = occurrencesBetween(rule, "09:00", 60, MON, new Date("2026-12-01T00:00:00Z"));
    expect(starts(occ).at(-1)).toBe("2026-10-21T03:30:00.000Z"); // Wed 21 Oct, the UNTIL date itself
    expect(occ).toHaveLength(6);
  });

  it("bounds a DATE-TIME UNTIL by the occurrence start instant", () => {
    const r = parseWeeklyRule("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261012T033000Z"); // exactly Mon 12 Oct 09:00 IST
    expect(starts(occurrencesBetween(r, "09:00", 60, MON, new Date("2026-12-01T00:00:00Z")))).toEqual([
      "2026-10-05T03:30:00.000Z",
      "2026-10-12T03:30:00.000Z",
    ]);
    expect(occurrencesBetween(r, "09:01", 60, MON, new Date("2026-12-01T00:00:00Z"))).toHaveLength(1);
  });

  it("excludes a start equal to `after` and includes an end equal to `through`", () => {
    const first = new Date("2026-10-05T03:30:00Z");
    expect(starts(occurrencesBetween(rule, "09:00", 60, first, new Date("2026-10-07T04:30:00Z")))).toEqual([
      "2026-10-07T03:30:00.000Z", // ends 04:30Z == through
    ]);
    expect(occurrencesBetween(rule, "09:00", 60, first, new Date("2026-10-07T04:29:59.999Z"))).toEqual([]);
  });

  it("handles an IST start time that falls on the previous UTC day", () => {
    const early = parseWeeklyRule("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231");
    const occ = occurrencesBetween(early, "02:00", 60, MON, new Date("2026-10-08T00:00:00Z"));
    expect(starts(occ)).toEqual(["2026-10-05T20:30:00.000Z"]); // Tue 6 Oct 02:00 IST
  });
});

describe("nextOccurrence", () => {
  it("finds the next occurrence, or null once UNTIL has passed", () => {
    const rule = parseWeeklyRule("FREQ=WEEKLY;BYDAY=SU;UNTIL=20261011");
    expect(iso(nextOccurrence(rule, "10:00", 60, MON)!.startsAt)).toBe("2026-10-11T04:30:00.000Z");
    expect(nextOccurrence(rule, "10:00", 60, new Date("2026-10-11T04:30:00Z"))).toBeNull();
  });
});
