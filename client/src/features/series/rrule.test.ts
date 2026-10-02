import { describe, expect, it } from "vitest";
import { buildWeeklyRrule, defaultRepeat, describeRrule, isDayKey, seriesStartTime, validateRepeat } from "./rrule";

// Runs with TZ=America/New_York: dates and weekdays must come out in IST.
const ist = (local: string) => new Date(`${local}+05:30`);

describe("buildWeeklyRrule", () => {
  it("builds exactly FREQ=WEEKLY;BYDAY=…;UNTIL=YYYYMMDD", () => {
    expect(buildWeeklyRrule({ days: [1, 3], until: "2026-12-31" })).toBe("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231");
  });

  it("lists days Monday first, with Sunday last, whatever order they were picked in", () => {
    expect(buildWeeklyRrule({ days: [0, 5, 1], until: "2026-12-31" })).toBe("FREQ=WEEKLY;BYDAY=MO,FR,SU;UNTIL=20261231");
    expect(buildWeeklyRrule({ days: [6, 5, 4, 3, 2, 1, 0], until: "2026-12-31" })).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;UNTIL=20261231",
    );
  });

  it("drops repeated days", () => {
    expect(buildWeeklyRrule({ days: [2, 2, 4], until: "2027-01-05" })).toBe("FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270105");
  });

  it("handles a single day and dates around year ends and leap days", () => {
    expect(buildWeeklyRrule({ days: [0], until: "2027-01-01" })).toBe("FREQ=WEEKLY;BYDAY=SU;UNTIL=20270101");
    expect(buildWeeklyRrule({ days: [2], until: "2028-02-29" })).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20280229");
  });

  it("refuses what the server would refuse", () => {
    expect(() => buildWeeklyRrule({ days: [], until: "2026-12-31" })).toThrow();
    expect(() => buildWeeklyRrule({ days: [7], until: "2026-12-31" })).toThrow();
    expect(() => buildWeeklyRrule({ days: [-1], until: "2026-12-31" })).toThrow();
    expect(() => buildWeeklyRrule({ days: [1], until: "2026-13-01" })).toThrow();
    expect(() => buildWeeklyRrule({ days: [1], until: "2027-02-29" })).toThrow();
    expect(() => buildWeeklyRrule({ days: [1], until: "31/12/2026" })).toThrow();
    expect(() => buildWeeklyRrule({ days: [1], until: "" })).toThrow();
  });

  it("never emits anything but the three supported parts", () => {
    const rule = buildWeeklyRrule({ days: [1, 2, 3], until: "2026-11-30" });
    expect(rule.split(";").map((p) => p.split("=")[0])).toEqual(["FREQ", "BYDAY", "UNTIL"]);
    expect(rule).not.toMatch(/[a-z\s]/);
  });
});

describe("validateRepeat", () => {
  const first = ist("2026-10-05T10:00:00"); // Monday

  it("needs a day and a real end date", () => {
    expect(validateRepeat({ days: [], until: "2026-11-01" }, first)).toBe("Choose at least one day of the week.");
    expect(validateRepeat({ days: [1], until: "" }, first)).toBe("Choose the last date it repeats until.");
    expect(validateRepeat({ days: [1], until: "2026-02-30" }, first)).toBe("Choose the last date it repeats until.");
  });

  it("refuses an end before the first booking's IST date, and allows the same date", () => {
    expect(validateRepeat({ days: [1], until: "2026-10-04" }, first)).toBe("The end date can't be before the first booking.");
    expect(validateRepeat({ days: [1], until: "2026-10-05" }, first)).toBeNull();
  });

  it("uses the IST date of a slot just after IST midnight", () => {
    // 00:30 IST Tuesday is still Monday afternoon in New York.
    expect(validateRepeat({ days: [2], until: "2026-10-05" }, ist("2026-10-06T00:30:00"))).toBe(
      "The end date can't be before the first booking.",
    );
  });
});

describe("defaultRepeat", () => {
  it("repeats on the slot's own IST weekday for four more weeks", () => {
    expect(defaultRepeat(ist("2026-10-05T10:00:00"))).toEqual({ days: [1], until: "2026-11-02" });
    expect(defaultRepeat(ist("2026-10-06T00:30:00"))).toEqual({ days: [2], until: "2026-11-03" });
    expect(defaultRepeat(ist("2026-12-20T09:00:00"))).toEqual({ days: [0], until: "2027-01-17" });
  });
});

describe("helpers", () => {
  it("takes the start time in IST", () => {
    expect(seriesStartTime(ist("2026-10-05T09:11:00"))).toBe("09:11");
    expect(seriesStartTime(ist("2026-10-06T00:30:00"))).toBe("00:30");
  });

  it("checks calendar dates", () => {
    expect(isDayKey("2026-10-05")).toBe(true);
    expect(isDayKey("2026-10-5")).toBe(false);
    expect(isDayKey("2026-04-31")).toBe(false);
  });

  it("describes the server's rule in words", () => {
    expect(describeRrule("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231")).toBe("Every Mon and Wed until Thu 31 Dec 2026");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231")).toBe("Every Mon, Wed and Fri until Thu 31 Dec 2026");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=SU;UNTIL=20261231T183000Z")).toBe("Every Sun until Thu 31 Dec 2026");
    expect(describeRrule("FREQ=DAILY;UNTIL=20261231")).toBeNull();
    expect(describeRrule("FREQ=WEEKLY;BYDAY=XX;UNTIL=20261231")).toBeNull();
  });

  it("round-trips: what it builds, it can describe", () => {
    expect(describeRrule(buildWeeklyRrule({ days: [5, 1], until: "2026-11-30" }))).toBe("Every Mon and Fri until Mon 30 Nov 2026");
  });
});
