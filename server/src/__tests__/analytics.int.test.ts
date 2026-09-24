import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { istInstant } from "../domain/booking-rules.js";
import {
  createDepartment,
  createHarness,
  createResource,
  createTestClock,
  insertBooking,
  insertCheckin,
  registerUser,
  resetDatabase,
  type ResourceFixture,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

// "Now" is Tue 20 Oct 2026, 17:30 IST — after every fixture below.
const NOW = new Date("2026-10-20T12:00:00.000Z");
const clock = createTestClock(NOW);
const DAY_MS = 86_400_000;
const at = (date: string, hhmm: string) => istInstant(date, hhmm);
// The week under test: Mon 5 – Sun 11 Oct 2026 (IST).
const MON = "2026-10-05";
const TUE = "2026-10-06";
const WED = "2026-10-07";
const THU = "2026-10-08";
const FRI = "2026-10-09";
const SAT = "2026-10-10";
const WEEK = { from: at(MON, "00:00"), to: at("2026-10-12", "00:00") };
const LONG_AGO = new Date("2026-01-01T00:00:00Z");

let h: TestHarness;
let cse: string;
let ece: string;
let student: TestUser;
let student2: TestUser;
let faculty: TestUser;
let admin: TestUser;
let eceIncharge: TestUser;

beforeAll(() => {
  h = createHarness({ clock: clock.now });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase(h.prisma);
  cse = await createDepartment(h.prisma, "CSE");
  ece = await createDepartment(h.prisma, "ECE");
  student = await registerUser(h, { email: "s1@college.edu", departmentId: cse });
  student2 = await registerUser(h, { email: "s2@college.edu", departmentId: cse });
  faculty = await registerUser(h, { email: "fac@college.edu", departmentId: cse, role: "faculty" });
  admin = await registerUser(h, { email: "admin@college.edu", departmentId: cse, role: "admin" });
  eceIncharge = await registerUser(h, { email: "ece@college.edu", departmentId: ece, role: "lab_incharge" });
});

const booking = (resourceId: string, userId: string, date: string, from: string, to: string, status: string) =>
  insertBooking(h.prisma, { resourceId, userId, start: at(date, from), end: at(date, to), status });

const get = (user: TestUser, path: string, query: Record<string, string> = {}) =>
  request(h.app).get(`/api/analytics/${path}`).set(user.auth).query(query);

const weekQuery = { from: WEEK.from.toISOString(), to: WEEK.to.toISOString() };

/**
 * Lab A: open 09:00–17:00 Mon–Fri. Over the test week:
 *   available = 5 days x 480 min                                    = 2400
 *   Mon 10:00–12:00 completed, checked in 10:05–11:50   booked 120, actual 105
 *   Tue 14:00–15:00 no_show                             booked  60, actual   0
 *   Wed 09:00–10:00 cancelled                           (not booked time)
 *   Thu 16:00–18:00 completed, auto-completed 16–18     booked 120, actual 120 (auto):
 *                                   16–17 in hours (60), 17–18 after closing (60 off-hours)
 *   Fri 10:00–11:00 rejected                            (not booked time)
 *   Fri 13:00–14:00 checked in at 13:00, still open     booked  60, actual   0 (not ended)
 *   booked = 360, actual = 225 = 165 in hours + 60 off-hours,
 *   utilization = 165 / 2400 = 0.06875
 * Scope B: default hours (08:00–18:00 Mon–Fri), unused: available 3000, 0.
 * Studio C: 10:00–14:00 Sat+Sun: available 2 x 240 = 480;
 *   Sat 11:00–13:00 completed, checked in 11:00–12:30: booked 120, actual 90 (all in hours), 0.1875.
 */
async function utilizationFixture() {
  const labA = await createResource(h.prisma, {
    departmentId: cse, name: "Lab A", businessHoursStart: "09:00", businessHoursEnd: "17:00", createdAt: LONG_AGO,
  });
  const scopeB = await createResource(h.prisma, { departmentId: cse, name: "Scope B", createdAt: LONG_AGO });
  const studioC = await createResource(h.prisma, {
    departmentId: cse, name: "Studio C", businessHoursStart: "10:00", businessHoursEnd: "14:00", businessDays: [0, 6], createdAt: LONG_AGO,
  });

  const mon = await booking(labA, student.id, MON, "10:00", "12:00", "completed");
  await insertCheckin(h.prisma, { bookingId: mon, in: at(MON, "10:05"), out: at(MON, "11:50") });
  await booking(labA, student.id, TUE, "14:00", "15:00", "no_show");
  await booking(labA, student.id, WED, "09:00", "10:00", "cancelled");
  const thu = await booking(labA, student.id, THU, "16:00", "18:00", "completed");
  await insertCheckin(h.prisma, { bookingId: thu, in: at(THU, "16:00"), out: at(THU, "18:00"), checkoutMethod: "auto" });
  await booking(labA, student.id, FRI, "10:00", "11:00", "rejected");
  const open = await booking(labA, student.id, FRI, "13:00", "14:00", "checked_in");
  await insertCheckin(h.prisma, { bookingId: open, in: at(FRI, "13:00"), out: null });

  const sat = await booking(studioC, student.id, SAT, "11:00", "13:00", "completed");
  await insertCheckin(h.prisma, { bookingId: sat, in: at(SAT, "11:00"), out: at(SAT, "12:30") });
  return { labA, scopeB, studioC };
}

describe("utilization", () => {
  it("matches the hand-computed figures for a full week", async () => {
    const { labA, scopeB, studioC } = await utilizationFixture();
    const res = await get(faculty, "utilization", weekQuery);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const byId = new Map<string, Record<string, unknown>>(
      res.body.data.resources.map((r: { resourceId: string }) => [r.resourceId, r]),
    );
    expect(byId.get(labA)).toMatchObject({
      availableMinutes: 2400, bookedMinutes: 360, actualMinutes: 225, inHoursMinutes: 165, offHoursMinutes: 60,
      autoCompletedMinutes: 120, bookings: 4, sessions: 2, utilization: 0.06875,
    });
    expect(byId.get(scopeB)).toMatchObject({ availableMinutes: 3000, bookedMinutes: 0, actualMinutes: 0, utilization: 0 });
    expect(byId.get(studioC)).toMatchObject({
      availableMinutes: 480, bookedMinutes: 120, actualMinutes: 90, inHoursMinutes: 90, offHoursMinutes: 0, utilization: 0.1875,
    });

    // Department totals: 255 in-hours / 5880 available; the 60 off-hours minutes are reported, not counted.
    expect(res.body.data.totals).toMatchObject({
      availableMinutes: 5880, bookedMinutes: 480, actualMinutes: 315, inHoursMinutes: 255, offHoursMinutes: 60,
    });
    expect(res.body.data.totals.utilization).toBeCloseTo(255 / 5880, 12);
    // Most used first.
    expect(res.body.data.resources.map((r: { name: string }) => r.name)).toEqual(["Studio C", "Lab A", "Scope B"]);
  });

  it("clips bookings, sessions and business hours to a window that starts and ends mid-day", async () => {
    const { labA } = await utilizationFixture();
    // [Mon 11:00, Fri 12:00) IST:
    //   available = Mon 11–17 (360) + Tue–Thu (3 x 480) + Fri 09–12 (180) = 1980
    //   booked    = Mon 11–12 (60) + Tue (60) + Thu (120); Fri 13:00 is outside = 240
    //   actual    = Mon 11:00–11:50 (50) + Thu (120)                          = 170
    //     of which in hours: Mon 50 + Thu 16–17 (60) = 110; off-hours: Thu 17–18 = 60
    const res = await get(faculty, "utilization", {
      resourceId: labA, from: at(MON, "11:00").toISOString(), to: at(FRI, "12:00").toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.resources).toHaveLength(1);
    expect(res.body.data.resources[0]).toMatchObject({
      availableMinutes: 1980, bookedMinutes: 240, actualMinutes: 170, inHoursMinutes: 110, offHoursMinutes: 60,
    });
    expect(res.body.data.resources[0].utilization).toBeCloseTo(110 / 1980, 12);
  });

  it("caps utilization at business hours on business days, reporting weekend and evening use separately", async () => {
    // Open 09:00–10:00, Monday–Friday only: available = 5 x 60 = 300 minutes.
    const desk = await createResource(h.prisma, {
      departmentId: cse, name: "Help Desk", businessHoursStart: "09:00", businessHoursEnd: "10:00", businessDays: [1, 2, 3, 4, 5],
      minSlotMinutes: 30, maxSlotMinutes: 600, createdAt: LONG_AGO,
    });
    const session = async (date: string, from: string, to: string) => {
      const id = await booking(desk, student.id, date, from, to, "completed");
      await insertCheckin(h.prisma, { bookingId: id, in: at(date, from), out: at(date, to) });
    };
    // Every weekday's open hour fully used: 300 in-hours minutes ...
    await session(MON, "09:00", "10:00");
    await session(WED, "09:00", "10:00");
    await session(THU, "09:00", "10:00");
    await session(FRI, "09:00", "10:00");
    // ... Tuesday's as two overlapping sessions (09:00–09:40 and 09:30–10:00):
    // together they cover the hour once, not 70 minutes.
    await session(TUE, "09:00", "09:40");
    await session(TUE, "09:30", "10:00");
    // Saturday is not a business day: 8 hours there are all off-hours, even
    // though 09:00–10:00 is inside the daily business hours.
    await session(SAT, "09:00", "17:00");
    // And a weekday evening: outside business hours on a business day.
    await session(MON, "18:00", "20:00");

    const res = await get(faculty, "utilization", { ...weekQuery, resourceId: desk });
    expect(res.status).toBe(200);
    // actual = 300 (weekdays, overlap merged) + 480 (Saturday) + 120 (Monday evening) = 900
    // Uncapped, that would be 900 / 300 = 3.0.
    expect(res.body.data.resources[0]).toMatchObject({
      availableMinutes: 300,
      actualMinutes: 900,
      inHoursMinutes: 300,
      offHoursMinutes: 600,
      sessions: 8,
      utilization: 1,
    });
  });

  it("counts available hours only from when the resource was created", async () => {
    // Created Wed 7 Oct 12:00 IST, default 08:00–18:00 Mon–Fri:
    //   Wed 12–18 (360) + Thu (600) + Fri (600) = 1560 of the week's 3000.
    const late = await createResource(h.prisma, { departmentId: cse, name: "Late Lab", createdAt: at(WED, "12:00") });
    const res = await get(faculty, "utilization", { ...weekQuery, resourceId: late });
    expect(res.body.data.resources[0]).toMatchObject({ availableMinutes: 1560 });

    // Created after the window closed: nothing was available.
    const later = await createResource(h.prisma, { departmentId: cse, name: "Later Lab", createdAt: at("2026-10-15", "12:00") });
    const none = await get(faculty, "utilization", { ...weekQuery, resourceId: later });
    expect(none.body.data.resources[0]).toMatchObject({ availableMinutes: 0, utilization: null });
  });

  it("clips a window that runs past now to now", async () => {
    await utilizationFixture();
    const res = await get(faculty, "utilization", { from: WEEK.from.toISOString(), to: new Date(NOW.getTime() + 30 * DAY_MS).toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.data.window).toEqual({ from: WEEK.from.toISOString(), to: NOW.toISOString() });

    const future = await get(faculty, "utilization", { from: new Date(NOW.getTime() + DAY_MS).toISOString() });
    expect(future.status).toBe(400);
  });
});

describe("no-show rate", () => {
  it("counts only attendance outcomes: rejected and expired never touch the denominator", async () => {
    const lab = await createResource(h.prisma, { departmentId: cse, name: "Lab", maxSlotMinutes: 60, createdAt: LONG_AGO });
    // One booking per hour on Mon/Tue, so no two slot-holding bookings overlap.
    let slot = 0;
    const next = (userId: string, status: string) => {
      const day = slot < 12 ? MON : TUE;
      const hour = String(6 + (slot % 12)).padStart(2, "0");
      slot += 1;
      return booking(lab, userId, day, `${hour}:00`, `${hour}:30`, status);
    };
    // Student 1: 1 no-show out of 4 outcomes, plus 7 non-outcomes.
    for (const s of ["no_show", "completed", "completed", "checked_in", "rejected", "rejected", "rejected", "cancelled", "cancelled", "pending", "approved"]) {
      await next(student.id, s);
    }
    // An expired booking: 'rejected' by the lapsed-pending job, audited as booking.expired.
    const expired = await next(student.id, "rejected");
    await h.prisma.auditLog.create({
      data: {
        actorId: null,
        entityType: "booking",
        entityId: expired,
        action: "booking.expired",
        before: { status: "pending" },
        after: { status: "rejected" },
      },
    });
    // Student 2: 2 of 4.
    for (const s of ["no_show", "no_show", "completed", "completed"]) await next(student2.id, s);

    const rates = async () => {
      const res = await get(faculty, "no-shows", weekQuery);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data;
    };
    const first = await rates();
    expect(first.overall).toEqual({ noShows: 3, attended: 5, outcomes: 8, rate: 3 / 8 });
    expect(first.byUser).toEqual([
      expect.objectContaining({ userId: student2.id, noShows: 2, attended: 2, outcomes: 4, rate: 0.5 }),
      expect.objectContaining({ userId: student.id, noShows: 1, attended: 3, outcomes: 4, rate: 0.25 }),
    ]);
    expect(first.byResource).toEqual([expect.objectContaining({ resourceId: lab, noShows: 3, outcomes: 8, rate: 0.375 })]);

    // Control: piling on more rejected / expired / cancelled bookings changes nothing.
    for (const s of ["rejected", "rejected", "rejected", "cancelled", "cancelled"]) await next(student.id, s);
    expect(await rates()).toEqual(first);
  });
});

describe("heatmap", () => {
  it("returns all 7 x 24 IST cells, zero-filled, with bookings split across the hours they touch", async () => {
    const lab = await createResource(h.prisma, { departmentId: cse, name: "Lab", createdAt: LONG_AGO });
    await booking(lab, student.id, MON, "10:00", "11:30", "completed"); // Mon 10: 60, Mon 11: 30
    await booking(lab, student.id, "2026-10-12", "10:30", "11:00", "no_show"); // next Mon 10: +30
    await booking(lab, student.id, WED, "09:00", "10:00", "cancelled"); // not booked time
    await booking(lab, student.id, WED, "14:00", "15:00", "rejected"); // not booked time

    const res = await get(faculty, "heatmap", { from: WEEK.from.toISOString(), to: at("2026-10-19", "00:00").toISOString() });
    expect(res.status).toBe(200);
    const cells: { dow: number; hour: number; bookedMinutes: number; bookings: number }[] = res.body.data.cells;
    expect(res.body.data.timezone).toBe("Asia/Kolkata");

    expect(cells).toHaveLength(168);
    const keys = new Set(cells.map((c) => `${c.dow}:${c.hour}`));
    expect(keys.size).toBe(168); // every (dow, hour) exactly once
    const cell = (dow: number, hour: number) => cells.find((c) => c.dow === dow && c.hour === hour);

    expect(cell(1, 10)).toEqual({ dow: 1, hour: 10, bookedMinutes: 90, bookings: 2 });
    expect(cell(1, 11)).toEqual({ dow: 1, hour: 11, bookedMinutes: 30, bookings: 1 });
    expect(cell(1, 4)).toEqual({ dow: 1, hour: 4, bookedMinutes: 0, bookings: 0 }); // 10:00 IST is 04:30 UTC
    expect(cell(3, 9)).toEqual({ dow: 3, hour: 9, bookedMinutes: 0, bookings: 0 }); // cancelled
    expect(cell(0, 3)).toEqual({ dow: 0, hour: 3, bookedMinutes: 0, bookings: 0 });
    expect(cells.filter((c) => c.bookedMinutes > 0)).toHaveLength(2);
  });
});

describe("idle ranking", () => {
  it("ranks least-used first and lists every excluded resource with its reason, at the 4-week boundary", async () => {
    const mech = await createDepartment(h.prisma, "MECH");
    const mechFaculty = await registerUser(h, { email: "mech@college.edu", departmentId: mech, role: "faculty" });
    const to = NOW;
    const from = new Date(to.getTime() - 56 * DAY_MS);
    const make = (name: string, extra: Partial<ResourceFixture>) =>
      createResource(h.prisma, { departmentId: mech, name, createdAt: LONG_AGO, ...extra });

    const idle = await make("Idle Lathe", {});
    const busy = await make("Busy CNC", {});
    const exactly28 = await make("New Mill", { createdAt: new Date(to.getTime() - 28 * DAY_MS) });
    const justUnder = await make("Newer Mill", { createdAt: new Date(to.getTime() - 28 * DAY_MS + 60_000) });
    const inactive = await make("Old Press", { isActive: false });
    const closed = await make("Never Open", { businessDays: [] });

    const b = await booking(busy, student.id, "2026-10-14", "10:00", "12:00", "completed");
    await insertCheckin(h.prisma, { bookingId: b, in: at("2026-10-14", "10:00"), out: at("2026-10-14", "12:00") });

    const res = await get(mechFaculty, "idle-ranking", { from: from.toISOString(), to: to.toISOString() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = res.body.data;
    expect(data.minimumDays).toBe(28);

    expect(data.ranked.map((r: { resourceId: string; rank: number }) => [r.rank, r.resourceId])).toEqual([
      [1, idle], // 0 used, created long ago
      [2, exactly28], // 0 used; exactly 28 days observed: eligible
      [3, busy],
    ]);
    expect(data.ranked[1].observedDays).toBe(28);
    expect(data.ranked[2].utilization).toBeGreaterThan(0);

    const excluded = new Map<string, { reason: string; observedDays: number; message: string }>(
      data.excluded.map((e: { resourceId: string }) => [e.resourceId, e]),
    );
    expect(excluded.size).toBe(3);
    expect(excluded.get(justUnder)).toMatchObject({ reason: "INSUFFICIENT_DATA" });
    expect(excluded.get(justUnder)?.observedDays).toBeCloseTo(28 - 1 / (24 * 60), 9);
    expect(excluded.get(justUnder)?.message).toMatch(/at least 28/);
    expect(excluded.get(inactive)).toMatchObject({ reason: "INACTIVE" });
    expect(excluded.get(closed)).toMatchObject({ reason: "NO_AVAILABLE_HOURS" });
  });

  it("excludes everything as insufficient when the window itself is shorter than 4 weeks", async () => {
    await createResource(h.prisma, { departmentId: cse, name: "Lab", createdAt: LONG_AGO });
    const res = await get(faculty, "idle-ranking", { from: new Date(NOW.getTime() - 27 * DAY_MS).toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.data.ranked).toEqual([]);
    expect(res.body.data.excluded).toEqual([expect.objectContaining({ reason: "INSUFFICIENT_DATA", observedDays: 27 })]);
  });
});

describe("department scoping", () => {
  const ENDPOINTS = ["utilization", "no-shows", "heatmap", "idle-ranking"] as const;

  /** Resource ids an endpoint's response mentions (heatmap: total booked minutes instead). */
  const covered = (path: (typeof ENDPOINTS)[number], data: Record<string, unknown>): unknown => {
    switch (path) {
      case "utilization":
        return (data.resources as { resourceId: string }[]).map((r) => r.resourceId).sort();
      case "no-shows":
        return (data.byResource as { resourceId: string }[]).map((r) => r.resourceId).sort();
      case "heatmap":
        return (data.cells as { bookedMinutes: number }[]).reduce((sum, c) => sum + c.bookedMinutes, 0);
      case "idle-ranking":
        return [...(data.ranked as { resourceId: string }[]), ...(data.excluded as { resourceId: string }[])]
          .map((r) => r.resourceId)
          .sort();
    }
  };

  it.each(ENDPOINTS)("%s: staff see their own department; other departments only for an admin who asks", async (path) => {
    const cseLab = await createResource(h.prisma, { departmentId: cse, name: "CSE Lab", createdAt: LONG_AGO });
    const eceLab = await createResource(h.prisma, { departmentId: ece, name: "ECE Lab", createdAt: LONG_AGO });
    const eceUser = await registerUser(h, { email: "ece-student@college.edu", departmentId: ece });
    await booking(cseLab, student.id, MON, "10:00", "11:00", "no_show"); // 60 booked minutes
    await booking(eceLab, eceUser.id, TUE, "10:00", "12:00", "completed"); // 120 booked minutes
    const window = { from: new Date(NOW.getTime() - 35 * DAY_MS).toISOString() };
    const expectOnly = async (user: TestUser, query: Record<string, string>, expected: { cse: boolean; ece: boolean }) => {
      const res = await get(user, path, { ...window, ...query });
      expect(res.status, `${path} ${JSON.stringify(query)}: ${JSON.stringify(res.body)}`).toBe(200);
      const got = covered(path, res.body.data);
      if (path === "heatmap") {
        expect(got).toBe((expected.cse ? 60 : 0) + (expected.ece ? 120 : 0));
      } else {
        expect(got).toEqual([...(expected.cse ? [cseLab] : []), ...(expected.ece ? [eceLab] : [])].sort());
      }
    };

    // Positive controls: each department's staff see their own data.
    await expectOnly(faculty, {}, { cse: true, ece: false });
    await expectOnly(eceIncharge, {}, { cse: false, ece: true });
    // An admin defaults to their own department, and sees others only on request.
    await expectOnly(admin, {}, { cse: true, ece: false });
    await expectOnly(admin, { departmentId: ece }, { cse: false, ece: true });
    await expectOnly(admin, { departmentId: "all" }, { cse: true, ece: true });
    await expectOnly(admin, { resourceId: eceLab }, { cse: false, ece: true });

    // Denials.
    const studentRes = await get(student, path, window);
    expect([studentRes.status, studentRes.body.error.code]).toEqual([403, "FORBIDDEN"]);
    for (const query of [{ departmentId: ece }, { departmentId: "all" }]) {
      const res = await get(faculty, path, { ...window, ...query });
      expect([res.status, res.body.error.code]).toEqual([403, "FORBIDDEN"]);
    }
    const hidden = await get(faculty, path, { ...window, resourceId: eceLab });
    expect([hidden.status, hidden.body.error.code]).toEqual([404, "NOT_FOUND"]);
    const mismatched = await get(admin, path, { ...window, resourceId: eceLab, departmentId: cse });
    expect(mismatched.status).toBe(404);
  });
});

describe("resource business hours", () => {
  it("defaults to 08:00–18:00 on weekdays and can be changed, with validation", async () => {
    const created = await request(h.app)
      .post("/api/resources")
      .set(admin.auth)
      .send({ departmentId: cse, name: "New Lab", type: "lab", location: "Block B", capacity: 10 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data).toMatchObject({ businessHoursStart: "08:00", businessHoursEnd: "18:00", businessDays: [1, 2, 3, 4, 5] });
    const id = created.body.data.id as string;
    const patch = (body: Record<string, unknown>) => request(h.app).patch(`/api/resources/${id}`).set(admin.auth).send(body);

    const ok = await patch({ businessHoursStart: "07:30", businessHoursEnd: "21:00", businessDays: [6, 1, 3] });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ businessHoursStart: "07:30", businessHoursEnd: "21:00", businessDays: [1, 3, 6] });

    const inverted = await patch({ businessHoursStart: "21:00" }); // equal to the end
    expect([inverted.status, inverted.body.error.code]).toEqual([422, "INVALID_BUSINESS_HOURS"]);
    for (const body of [{ businessDays: [1, 1] }, { businessDays: [7] }, { businessHoursEnd: "24:00" }]) {
      expect((await patch(body)).status).toBe(400);
    }
    // Utilization follows the new hours: one Monday, 07:30–21:00 = 810 minutes.
    const res = await get(admin, "utilization", {
      resourceId: id, from: at("2026-10-19", "00:00").toISOString(), to: at("2026-10-20", "00:00").toISOString(),
    });
    expect(res.body.data.resources[0].availableMinutes).toBe(810);
  });
});
