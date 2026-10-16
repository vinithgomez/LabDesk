import { describe, expect, it } from "vitest";
import { istDate, istInstant } from "../domain/booking-rules.js";
import {
  planMaintenance,
  planUpcoming,
  seriesRule,
  upcomingDates,
  type Interval,
  type PlannedUpcoming,
  type UpcomingPlanInput,
  type UpcomingResource,
  type WeeklyAnchor,
  type WeeklySlot,
} from "./seed-upcoming.js";

/** The pure planner for the upcoming demo data (seed-upcoming.ts). No database. */

const DAY_MS = 86_400_000;
const WEEKDAYS = [1, 2, 3, 4, 5];
const ARJUN = "u-arjun";
const ANITA = "u-anita";
const RAVI = "u-ravi";
const STUDENTS = [ARJUN, "u-priya", "u-kabir", "u-neha"];

const resource = (over: Partial<UpcomingResource> & Pick<UpcomingResource, "id" | "name">): UpcomingResource => ({
  requiresApproval: false,
  capacity: 40,
  minSlotMinutes: 60,
  maxSlotMinutes: 180,
  bookingHorizonDays: 14,
  businessHoursStart: "08:00",
  businessHoursEnd: "20:00",
  businessDays: [1, 2, 3, 4, 5, 6],
  owners: [{ userId: RAVI, approvalLevel: 1 }],
  intensity: 0.6,
  lengths: [60, 120, 180],
  bookers: STUDENTS.map((userId, i) => ({ userId, weight: 1 + (i % 3) * 0.5 })),
  purposes: ["Lab record work", "DBMS lab practice"],
  attendees: { min: 4, max: 36 },
  ...over,
});

const LAB = resource({ id: "r-lab", name: "Systems Lab" });
const PRINTER = resource({
  id: "r-printer", name: "3D Printer", capacity: 1, maxSlotMinutes: 240, businessHoursStart: "09:00", businessHoursEnd: "18:00",
  businessDays: WEEKDAYS, intensity: 0.3, lengths: [120, 180, 240], attendees: { min: 1, max: 2 },
});
const GPU = resource({
  id: "r-gpu", name: "GPU Workstation", requiresApproval: true, capacity: 1, maxSlotMinutes: 240, bookingHorizonDays: 7,
  businessHoursEnd: "22:00", businessDays: [0, 1, 2, 3, 4, 5, 6], intensity: 0.5, lengths: [120, 180, 240],
  owners: [{ userId: ANITA, approvalLevel: 1 }, { userId: RAVI, approvalLevel: 2 }], attendees: { min: 1, max: 1 },
});
const SEMINAR = resource({
  id: "r-seminar", name: "Seminar Room", requiresApproval: true, capacity: 60, minSlotMinutes: 30, maxSlotMinutes: 240,
  bookingHorizonDays: 30, businessHoursStart: "09:00", businessHoursEnd: "17:00", businessDays: WEEKDAYS, intensity: 0.22,
  lengths: [60, 90, 120], owners: [{ userId: ANITA, approvalLevel: 1 }],
  bookers: [ANITA, RAVI].map((userId) => ({ userId, weight: 1 })), attendees: { min: 15, max: 60 },
});
const IDLE = resource({ id: "r-idle", name: "Logic Analyzer", capacity: 1, intensity: 0, attendees: { min: 1, max: 2 } });
const RESOURCES = [LAB, PRINTER, GPU, SEMINAR, IDLE];

const ANCHORS: WeeklyAnchor[] = [
  { resourceId: LAB.id, weekday: 1, start: "10:00", minutes: 120, userId: ARJUN, purpose: "Mini-project demo", attendeeCount: 4, status: "approved" },
  { resourceId: PRINTER.id, weekday: 3, start: "14:00", minutes: 120, userId: ARJUN, purpose: "Final-year project parts", attendeeCount: 1, status: "approved" },
  { resourceId: LAB.id, weekday: 5, start: "09:00", minutes: 120, userId: ARJUN, purpose: "Lab record work", attendeeCount: 1, status: "approved" },
  { resourceId: SEMINAR.id, weekday: 3, start: "11:00", minutes: 90, userId: RAVI, purpose: "Project review panel", attendeeCount: 25, status: "pending" },
  { resourceId: SEMINAR.id, weekday: 5, start: "14:00", minutes: 60, userId: RAVI, purpose: "Workshop", attendeeCount: 40, status: "pending" },
  { resourceId: GPU.id, weekday: 2, start: "10:00", minutes: 180, userId: "u-priya", purpose: "Model training run", attendeeCount: 1, status: "pending" },
];
const SERIES: WeeklySlot = { resourceId: LAB.id, weekdays: [2, 4], start: "14:00", minutes: 120, userId: ARJUN };

const ist = (local: string) => new Date(`${local}+05:30`);
/** A Saturday morning; the seven `nows` below cover every weekday. */
const NOW = ist("2026-10-17T09:30:00");
const NOWS = Array.from({ length: 7 }, (_, i) => new Date(NOW.getTime() + i * DAY_MS));

const input = (now: Date, over: Partial<UpcomingPlanInput> = {}): UpcomingPlanInput => ({
  now,
  resources: RESOURCES,
  anchors: ANCHORS,
  reservedWeekly: [SERIES],
  blocked: new Map(),
  ...over,
});

const minutesOf = (d: Date) => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(d)
    .split(":")
    .map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const weekdayOf = (d: Date) => new Date(`${istDate(d)}T00:00:00Z`).getUTCDay();
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const byId = new Map(RESOURCES.map((r) => [r.id, r]));

describe("upcomingDates", () => {
  it("is tomorrow through 12 days ahead, in IST", () => {
    // 23:00 IST on the 17th is still the 17th in IST (17:30 UTC).
    const dates = upcomingDates(ist("2026-10-17T23:00:00"));
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe("2026-10-18");
    expect(dates[11]).toBe("2026-10-29");
  });
});

describe("planUpcoming", () => {
  it("is deterministic for a given date", () => {
    expect(planUpcoming(input(NOW))).toEqual(planUpcoming(input(NOW)));
    expect(planUpcoming(input(NOW)).length).toBeGreaterThan(20);
  });

  it("plans the same bookings for a date whichever day the seed runs", () => {
    // Seminar Room's 30-day horizon covers both runs, so only the dates differ.
    const onSeminar = (plan: PlannedUpcoming[]) => plan.filter((p) => p.resourceId === SEMINAR.id);
    const today = onSeminar(planUpcoming(input(NOW)));
    const nextDay = onSeminar(planUpcoming(input(new Date(NOW.getTime() + DAY_MS))));
    const shared = (p: PlannedUpcoming) => istDate(p.start) >= "2026-10-19" && istDate(p.start) <= "2026-10-29";
    expect(nextDay.filter(shared)).toEqual(today.filter(shared));
  });

  it.each(NOWS.map((now) => [istDate(now), now]))("never overlaps on one resource (run on %s)", (_label, now) => {
    const plan = planUpcoming(input(now));
    for (const r of RESOURCES) {
      const mine = plan.filter((p) => p.resourceId === r.id);
      mine.forEach((a, i) => mine.slice(i + 1).forEach((b) => expect(overlaps(a, b), `${r.name} ${a.key} / ${b.key}`).toBe(false)));
    }
  });

  it.each(NOWS.map((now) => [istDate(now), now]))("never books one person in two places at once (run on %s)", (_label, now) => {
    const plan = planUpcoming(input(now));
    const people = new Set(plan.map((p) => p.userId));
    for (const person of people) {
      const theirs = plan.filter((p) => p.userId === person);
      theirs.forEach((a, i) => theirs.slice(i + 1).forEach((b) => expect(overlaps(a, b), `${person} ${a.key} / ${b.key}`).toBe(false)));
    }
    // Nor during their series.
    for (const p of plan.filter((x) => x.userId === ARJUN && [2, 4].includes(weekdayOf(x.start)))) {
      const date = istDate(p.start);
      expect(overlaps(p, { start: ist(`${date}T14:00:00`), end: ist(`${date}T16:00:00`) })).toBe(false);
    }
  });

  it.each(NOWS.map((now) => [istDate(now), now]))("stays inside business hours and days (run on %s)", (_label, now) => {
    for (const p of planUpcoming(input(now))) {
      const r = byId.get(p.resourceId) as UpcomingResource;
      expect(r.businessDays).toContain(weekdayOf(p.start));
      expect(istDate(p.start)).toBe(istDate(new Date(p.end.getTime() - 1)));
      expect(minutesOf(p.start)).toBeGreaterThanOrEqual(minutesOf(istInstant("2026-01-01", r.businessHoursStart)));
      expect(minutesOf(p.end) || 1440).toBeLessThanOrEqual(minutesOf(istInstant("2026-01-01", r.businessHoursEnd)));
    }
  });

  it.each(NOWS.map((now) => [istDate(now), now]))("stays in the future and inside each horizon (run on %s)", (_label, now) => {
    for (const p of planUpcoming(input(now))) {
      const r = byId.get(p.resourceId) as UpcomingResource;
      expect(p.start.getTime()).toBeGreaterThan(now.getTime());
      expect(p.end.getTime()).toBeLessThanOrEqual(now.getTime() + r.bookingHorizonDays * DAY_MS);
      expect(istDate(p.start) <= istDate(new Date(now.getTime() + 12 * DAY_MS))).toBe(true);
    }
  });

  it("respects each resource's capacity and booking length", () => {
    for (const p of planUpcoming(input(NOW))) {
      const r = byId.get(p.resourceId) as UpcomingResource;
      const minutes = (p.end.getTime() - p.start.getTime()) / 60_000;
      expect(p.attendeeCount).toBeGreaterThanOrEqual(1);
      expect(p.attendeeCount).toBeLessThanOrEqual(r.capacity);
      expect(minutes).toBeGreaterThanOrEqual(r.minSlotMinutes);
      expect(minutes).toBeLessThanOrEqual(r.maxSlotMinutes);
      expect(r.purposes.includes(p.purpose) || ANCHORS.some((a) => a.purpose === p.purpose)).toBe(true);
    }
  });

  it("keeps clear of maintenance windows and the series' weekly slots", () => {
    const window = { start: ist("2026-10-21T10:00:00"), end: ist("2026-10-21T13:00:00") };
    const plan = planUpcoming(input(NOW, { blocked: new Map([[PRINTER.id, [window]]]) }));
    expect(plan.filter((p) => p.resourceId === PRINTER.id).some((p) => overlaps(p, window))).toBe(false);
    for (const p of plan.filter((x) => x.resourceId === LAB.id && [2, 4].includes(weekdayOf(x.start)))) {
      const date = istDate(p.start);
      expect(overlaps(p, { start: ist(`${date}T14:00:00`), end: ist(`${date}T16:00:00`) })).toBe(false);
    }
  });

  it("never lets an owner book a resource that needs their approval", () => {
    for (const p of planUpcoming(input(NOW)).filter((x) => byId.get(x.resourceId)?.requiresApproval)) {
      expect(byId.get(p.resourceId)?.owners.map((o) => o.userId)).not.toContain(p.userId);
    }
  });

  it("is approved on resources that need no approval, and mixes approved and pending where it is needed", () => {
    const plan = planUpcoming(input(NOW));
    expect(plan.filter((p) => !byId.get(p.resourceId)?.requiresApproval).every((p) => p.status === "approved")).toBe(true);
    const gated = plan.filter((p) => byId.get(p.resourceId)?.requiresApproval);
    expect(gated.some((p) => p.status === "approved")).toBe(true);
    expect(gated.some((p) => p.status === "pending")).toBe(true);
  });

  it.each(NOWS.map((now) => [istDate(now), now]))(
    "always gives Arjun 3 approved and Dr. Rao 2 waiting requests (run on %s)",
    (_label, now) => {
      const plan = planUpcoming(input(now));
      expect(plan.filter((p) => p.userId === ARJUN && p.status === "approved").length).toBeGreaterThanOrEqual(3);
      const anitaLevel1 = new Set(RESOURCES.filter((r) => r.owners.some((o) => o.userId === ANITA && o.approvalLevel === 1)).map((r) => r.id));
      expect(plan.filter((p) => anitaLevel1.has(p.resourceId) && p.status === "pending").length).toBeGreaterThanOrEqual(2);
    },
  );

  it("refuses an anchor that breaks the resource's rules", () => {
    const bad: WeeklyAnchor = { ...ANCHORS[0], start: "19:30" } as WeeklyAnchor;
    expect(() => planUpcoming(input(NOW, { anchors: [bad] }))).toThrow(/doesn't fit/);
  });

  it("leaves an idle resource idle", () => {
    expect(planUpcoming(input(NOW)).filter((p) => p.resourceId === IDLE.id)).toEqual([]);
  });
});

describe("planMaintenance", () => {
  it.each(NOWS.map((now) => [istDate(now), now]))("is 3 hours on a business day 3 to 10 days ahead (run on %s)", (_label, now) => {
    const w = planMaintenance(PRINTER, now, "10:00", 3);
    expect(w.end.getTime() - w.start.getTime()).toBe(3 * 3_600_000);
    expect(PRINTER.businessDays).toContain(weekdayOf(w.start));
    expect(minutesOf(w.start)).toBe(600);
    const daysAhead = (Date.parse(istDate(w.start)) - Date.parse(istDate(now))) / DAY_MS;
    expect(daysAhead).toBeGreaterThanOrEqual(3);
    expect(daysAhead).toBeLessThanOrEqual(10);
  });

  it("moves inside business hours when the wanted time doesn't fit", () => {
    const w = planMaintenance(PRINTER, NOW, "16:00", 3);
    expect(minutesOf(w.start)).toBe(15 * 60);
    expect(minutesOf(w.end)).toBe(18 * 60);
  });
});

describe("seriesRule", () => {
  it("is the server's weekly form, Monday-first, until about six weeks out", () => {
    expect(seriesRule([4, 2], NOW)).toBe("FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261128");
  });
});
