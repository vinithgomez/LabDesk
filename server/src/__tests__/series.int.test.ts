import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signResourceQr } from "../auth/qr-signature.js";
import { istInstant } from "../domain/booking-rules.js";
import {
  book,
  createDepartment,
  createHarness,
  createMaintenanceWindow,
  createResource,
  createTestClock,
  registerUser,
  resetDatabase,
  resetRedis,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

// Monday 5 Oct 2026, 10:00 IST. The lab takes 30–120 minute slots, 7 days
// ahead, so the booking horizon ends Monday 12 Oct 10:00 IST.
const T0 = new Date("2026-10-05T04:30:00.000Z");
const clock = createTestClock(T0);
const DATES = { mon: "2026-10-05", tue: "2026-10-06", wed: "2026-10-07", thu: "2026-10-08", fri: "2026-10-09", nextMon: "2026-10-12", nextWed: "2026-10-14" };
const at = (date: string, hhmm: string) => istInstant(date, hhmm);
const iso = (date: string, hhmm: string) => at(date, hhmm).toISOString();

let h: TestHarness;
let dept: string;
let lab: string;
let alice: TestUser;
let bob: TestUser;
let owner: TestUser;

beforeAll(() => {
  h = createHarness({ clock: clock.now });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  clock.set(T0);
  await Promise.all([resetDatabase(h.prisma), resetRedis(h.redis)]);
  dept = await createDepartment(h.prisma, "CSE");
  alice = await registerUser(h, { email: "alice@college.edu", departmentId: dept });
  bob = await registerUser(h, { email: "bob@college.edu", departmentId: dept });
  owner = await registerUser(h, { email: "owner@college.edu", departmentId: dept, role: "lab_incharge" });
  lab = await createResource(h.prisma, { departmentId: dept, ownerIds: [owner.id] });
});

const MWF = "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231";
const createSeries = (user: TestUser, body: Record<string, unknown>) =>
  request(h.app)
    .post("/api/series")
    .set(user.auth)
    .send({ resourceId: lab, rrule: MWF, startTime: "14:00", durationMinutes: 60, ...body });
const created = async (user: TestUser, body: Record<string, unknown> = {}) => {
  const res = await createSeries(user, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as SeriesBody;
};
const getSeries = (user: TestUser, id: string) => request(h.app).get(`/api/series/${id}`).set(user.auth);

interface SeriesBody {
  id: string;
  status: string;
  materializedThrough: string | null;
  occurrences: { bookingId: string; start: string; end: string; status: string }[];
  skipped: { start: string; end: string; reason: string; message: string }[];
}
const starts = (s: SeriesBody) => s.occurrences.map((o) => o.start);
const statusOf = async (id: string) => (await h.prisma.booking.findUniqueOrThrow({ where: { id } })).status;

describe("creating a series", () => {
  it("books each occurrence up to the resource's booking horizon, and the nightly run extends it", async () => {
    const series = await created(alice, { purpose: "Weekly lab", attendeeCount: 4 });

    // Mon 12 Oct 14:00–15:00 ends after the horizon (Mon 12 Oct 10:00): not yet.
    expect(starts(series)).toEqual([iso(DATES.mon, "14:00"), iso(DATES.wed, "14:00"), iso(DATES.fri, "14:00")]);
    expect(series.occurrences.every((o) => o.status === "approved")).toBe(true);
    expect(series.skipped).toEqual([]);
    expect(series.materializedThrough).toBe(iso(DATES.fri, "14:00"));
    expect(await h.prisma.booking.findMany({ where: { seriesId: series.id } })).toEqual(
      Array(3).fill(expect.objectContaining({ userId: alice.id, purpose: "Weekly lab", attendeeCount: 4 })),
    );
    expect(await h.prisma.auditLog.count({ where: { action: "series.created", actorId: alice.id } })).toBe(1);
    expect(await h.prisma.auditLog.count({ where: { action: "booking.created", actorId: alice.id } })).toBe(3);

    // A day later the horizon has moved past Mon 12 Oct 15:00.
    clock.set(at(DATES.tue, "10:00"));
    expect(await h.services.series.runMaterializer()).toEqual({ series: 1, created: 1, skipped: 0, paused: 0, failed: 0 });
    const extended = (await getSeries(alice, series.id)).body.data as SeriesBody;
    expect(starts(extended).at(-1)).toBe(iso(DATES.nextMon, "14:00"));
    expect(await h.prisma.auditLog.count({ where: { action: "booking.created", actorId: null } })).toBe(1);

    // Idempotent: nothing new until time moves again.
    expect(await h.services.series.runMaterializer()).toEqual({ series: 1, created: 0, skipped: 0, paused: 0, failed: 0 });
  });

  it("includes an occurrence ending exactly at the horizon, and uses each resource's own horizon", async () => {
    // Mon 12 Oct 09:00–10:00 ends at exactly now + 7 days; today's 09:00 has passed.
    const edge = await created(alice, { rrule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231", startTime: "09:00" });
    expect(starts(edge)).toEqual([iso(DATES.nextMon, "09:00")]);

    const shortHorizon = await createResource(h.prisma, { departmentId: dept, name: "Scope", bookingHorizonDays: 2 });
    const res = await createSeries(alice, { resourceId: shortHorizon, rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH;UNTIL=20261231" });
    expect(res.status).toBe(201);
    // Horizon ends Wed 7 Oct 10:00: Mon and Tue fit, Wed 14:00 does not.
    expect(starts(res.body.data)).toEqual([iso(DATES.mon, "14:00"), iso(DATES.tue, "14:00")]);
  });

  it("validates like a booking and creates nothing when it fails", async () => {
    const otherDept = await createDepartment(h.prisma, "ECE");
    const foreign = await createResource(h.prisma, { departmentId: otherDept, name: "ECE Lab" });
    const inactive = await createResource(h.prisma, { departmentId: dept, name: "Old Lab", isActive: false });
    const admin = await registerUser(h, { email: "admin@college.edu", departmentId: otherDept, role: "admin" });

    const cases: [TestUser, Record<string, unknown>, number, string][] = [
      [alice, { durationMinutes: 150 }, 422, "SLOT_TOO_LONG"],
      [alice, { durationMinutes: 15 }, 422, "SLOT_TOO_SHORT"],
      [alice, { startTime: "23:30" }, 422, "MULTI_DAY_NOT_SUPPORTED"],
      [alice, { attendeeCount: 31 }, 422, "CAPACITY_EXCEEDED"],
      [alice, { rrule: "FREQ=DAILY;UNTIL=20261231" }, 422, "INVALID_RRULE"],
      [alice, { rrule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261001" }, 422, "INVALID_RRULE"], // UNTIL already passed
      [alice, { startTime: "9:00" }, 400, "VALIDATION_ERROR"],
      [alice, { userId: bob.id }, 400, "VALIDATION_ERROR"], // a series is always the caller's own
      [alice, { resourceId: inactive }, 403, "FORBIDDEN"],
      [alice, { resourceId: foreign }, 404, "NOT_FOUND"],
      [admin, { resourceId: lab }, 403, "WRONG_DEPARTMENT"],
    ];
    for (const [user, body, status, code] of cases) {
      const res = await createSeries(user, body);
      expect({ body, status: res.status, code: res.body.error?.code }).toEqual({ body, status, code });
    }
    expect(await h.prisma.bookingSeries.count()).toBe(0);
    expect(await h.prisma.booking.count()).toBe(0);
  });
});

describe("materializing around conflicts", () => {
  it("skips a conflicting occurrence, records why, and keeps materializing the rest", async () => {
    const bobs = await book(h, bob, { resourceId: lab, start: iso(DATES.wed, "14:30"), end: iso(DATES.wed, "15:30") });
    expect(bobs.status).toBe(201);
    await createMaintenanceWindow(h.prisma, {
      resourceId: lab,
      start: iso(DATES.fri, "13:00"),
      end: iso(DATES.fri, "14:30"),
      createdBy: owner.id,
    });

    const series = await created(alice);
    expect(starts(series)).toEqual([iso(DATES.mon, "14:00")]);
    expect(series.skipped).toEqual([
      expect.objectContaining({ start: iso(DATES.wed, "14:00"), end: iso(DATES.wed, "15:00"), reason: "SLOT_CONFLICT" }),
      expect.objectContaining({ start: iso(DATES.fri, "14:00"), end: iso(DATES.fri, "15:00"), reason: "MAINTENANCE_BLOCKED" }),
    ]);
    expect(series.materializedThrough).toBe(iso(DATES.fri, "14:00"));
    const skipAudits = await h.prisma.auditLog.findMany({
      where: { entityId: series.id, action: "series.occurrence_skipped" },
      select: { actorId: true, after: true },
    });
    expect(skipAudits).toHaveLength(2);
    expect(skipAudits.map((a) => (a.after as { skipped: { reason: string } }).skipped.reason).sort()).toEqual([
      "MAINTENANCE_BLOCKED",
      "SLOT_CONFLICT",
    ]);

    // Bob frees Wednesday; the series moves on without retrying a skipped date.
    await request(h.app).post(`/api/bookings/${bobs.body.data.id}/cancel`).set(bob.auth).expect(200);
    clock.set(at(DATES.tue, "10:00"));
    expect(await h.services.series.runMaterializer()).toMatchObject({ created: 1, skipped: 0 });
    const later = (await getSeries(alice, series.id)).body.data as SeriesBody;
    expect(starts(later)).toEqual([iso(DATES.mon, "14:00"), iso(DATES.nextMon, "14:00")]);
    expect(later.skipped).toHaveLength(2);
  });

  it("never double-books an occurrence when two materializer runs race on one series", async () => {
    const series = await created(alice);
    clock.set(at(DATES.thu, "10:00")); // horizon now reaches Mon 12 and Wed 14 Oct

    const [one, two] = await Promise.all([
      h.services.series.materialize(series.id, null),
      h.services.series.materialize(series.id, null),
    ]);
    expect(one.created + two.created).toBe(2);
    expect(one.skipped + two.skipped).toBe(0);
    const occurrences = (await getSeries(alice, series.id)).body.data as SeriesBody;
    expect(starts(occurrences)).toEqual([
      iso(DATES.mon, "14:00"),
      iso(DATES.wed, "14:00"),
      iso(DATES.fri, "14:00"),
      iso(DATES.nextMon, "14:00"),
      iso(DATES.nextWed, "14:00"),
    ]);
    expect(occurrences.skipped).toEqual([]);
  });
});

describe("cancelling a series", () => {
  const scan = async (user: TestUser) => {
    const { qrSecret } = await h.prisma.resource.findUniqueOrThrow({ where: { id: lab } });
    const res = await request(h.app)
      .post("/api/checkin")
      .set(user.auth)
      .send({ resourceId: lab, sig: signResourceQr(qrSecret, lab) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };

  it("cancels only future occurrences that are still cancellable", async () => {
    // Weekdays 10:15–11:15: Mon 5 .. Fri 9 Oct.
    const series = await created(alice, { rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261231", startTime: "10:15" });
    const [mon, tue, wed, thu, fri] = series.occurrences.map((o) => o.bookingId) as [string, string, string, string, string];

    clock.set(at(DATES.mon, "10:10"));
    await scan(alice); // Mon: checked in ...
    clock.set(at(DATES.mon, "11:00"));
    await scan(alice); // ... and out: completed
    await request(h.app).post(`/api/bookings/${fri}/cancel`).set(alice.auth).expect(200); // Fri: cancelled on its own
    clock.set(at(DATES.tue, "10:10"));
    await scan(alice); // Tue: checked in, never checked out

    // Wed 10:20: Wednesday's occurrence is under way (approved, not attended).
    clock.set(at(DATES.wed, "10:20"));
    const res = await request(h.app).delete(`/api/series/${series.id}`).set(alice.auth);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ status: "cancelled", cancelledAt: at(DATES.wed, "10:20").toISOString() });

    expect({
      mon: await statusOf(mon),
      tue: await statusOf(tue),
      wed: await statusOf(wed),
      thu: await statusOf(thu),
      fri: await statusOf(fri),
    }).toEqual({ mon: "completed", tue: "checked_in", wed: "approved", thu: "cancelled", fri: "cancelled" });

    // Only Thursday was cancelled by the series (Friday keeps its single, earlier audit row).
    const cancellations = await h.prisma.auditLog.findMany({
      where: { action: "booking.cancelled" },
      select: { entityId: true, actorId: true },
    });
    expect(cancellations).toHaveLength(2);
    expect(cancellations).toEqual(expect.arrayContaining([{ entityId: thu, actorId: alice.id }, { entityId: fri, actorId: alice.id }]));
    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: series.id, action: "series.cancelled" } });
    expect(audit?.actorId).toBe(alice.id);
    expect(audit?.after).toMatchObject({ status: "cancelled", cancelledBookingIds: [thu] });

    // A cancelled series is never materialized again, and can't be cancelled twice.
    clock.set(at(DATES.fri, "10:00"));
    expect(await h.services.series.runMaterializer()).toEqual({ series: 0, created: 0, skipped: 0, paused: 0, failed: 0 });
    const again = await request(h.app).delete(`/api/series/${series.id}`).set(alice.auth);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("is allowed to the series owner, the resource's owners and admins, and hidden from everyone else", async () => {
    const admin = await registerUser(h, { email: "admin@college.edu", departmentId: dept, role: "admin" });
    const a = await created(alice);
    const b = await created(alice, { rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231" });
    const c = await created(alice, { rrule: "FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231" });

    for (const [user, id] of [[bob, a.id]] as const) {
      expect((await getSeries(user, id)).status).toBe(404);
      const del = await request(h.app).delete(`/api/series/${id}`).set(user.auth);
      expect(del.status).toBe(404);
    }
    for (const [user, id] of [[alice, a.id], [owner, b.id], [admin, c.id]] as const) {
      expect((await getSeries(user, id)).status).toBe(200);
      const del = await request(h.app).delete(`/api/series/${id}`).set(user.auth);
      expect(del.status, JSON.stringify(del.body)).toBe(200);
      const cancelled = await h.prisma.auditLog.findFirst({ where: { entityId: id, action: "series.cancelled" } });
      expect(cancelled?.actorId).toBe(user.id);
    }
  });

  it("pauses materialization while the resource is inactive, recording nothing as skipped", async () => {
    const series = await created(alice);
    await h.prisma.resource.update({ where: { id: lab }, data: { isActive: false } });
    clock.set(at(DATES.tue, "10:00"));
    expect(await h.services.series.runMaterializer()).toEqual({ series: 1, created: 0, skipped: 0, paused: 1, failed: 0 });
    expect(await h.prisma.bookingSeriesSkip.count({ where: { seriesId: series.id } })).toBe(0);
  });
});
