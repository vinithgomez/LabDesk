import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { z } from "zod";
import { createServices, type Services } from "../container.js";
import { istInstant } from "../domain/booking-rules.js";
import { DomainError } from "../domain/errors.js";
import type { Actor } from "../domain/types.js";
import { createUnitOfWork, type TxRepositories, type UnitOfWork } from "../repositories/index.js";
import {
  createDepartment,
  createHarness,
  createResource,
  createTestClock,
  insertBooking,
  insertCheckin,
  registerUser,
  resetDatabase,
  testConfig,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

// Tue 20 Oct 2026, 10:00 IST.
const NOW = new Date("2026-10-20T04:30:00.000Z");
const TOMORROW = "2026-10-21";
const clock = createTestClock(NOW);
const MIN = 60_000;
const iso = (hhmm: string, date = TOMORROW) => istInstant(date, hhmm).toISOString();

let h: TestHarness;
let dept: string;
let lab: string;
let student: TestUser;
let owner: TestUser;

beforeAll(() => {
  h = createHarness({ clock: clock.now });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase(h.prisma);
  dept = await createDepartment(h.prisma, "CSE");
  student = await registerUser(h, { email: "s@college.edu", departmentId: dept });
  owner = await registerUser(h, { email: "owner@college.edu", departmentId: dept, role: "lab_incharge" });
  lab = await createResource(h.prisma, { departmentId: dept, name: "Systems Lab", ownerIds: [owner.id] });
});

const book = async (user: TestUser, from: string, to: string, key = `k-${from}-${to}-${Math.random()}`) => {
  const res = await request(h.app)
    .post("/api/bookings")
    .set(user.auth)
    .set("Idempotency-Key", key)
    .send({ resourceId: lab, start: iso(from), end: iso(to) });
  return res;
};
const booked = async (user: TestUser, from: string, to: string): Promise<string> => {
  const res = await book(user, from, to);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
};
const createWindow = (user: TestUser, body: Record<string, unknown>) =>
  request(h.app).post("/api/maintenance").set(user.auth).send({ resourceId: lab, reason: "Projector replacement", ...body });
const statusOf = async (id: string) => (await h.prisma.booking.findUniqueOrThrow({ where: { id } })).status;

describe("creating a maintenance window", () => {
  it("cancels every overlapping booking, audited as booking.cancelled_by_maintenance and explained on the booking", async () => {
    const early = await booked(student, "10:00", "11:00");
    const straddling = await booked(student, "12:00", "13:00");
    const outside = await booked(student, "15:00", "16:00");

    const res = await createWindow(owner, { start: iso("09:30"), end: iso("12:30") });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const windowId = res.body.data.id as string;
    expect(res.body.data).toMatchObject({ start: iso("09:30"), end: iso("12:30"), reason: "Projector replacement", removedAt: null });
    expect(res.body.data.cancelledBookingIds).toEqual([early, straddling]);

    expect([await statusOf(early), await statusOf(straddling), await statusOf(outside)]).toEqual(["cancelled", "cancelled", "approved"]);
    const audits = await h.prisma.auditLog.findMany({
      where: { entityId: { in: [early, straddling] }, action: { startsWith: "booking.cancelled" } },
      select: { action: true, actorId: true },
    });
    expect(audits).toEqual([
      { action: "booking.cancelled_by_maintenance", actorId: owner.id },
      { action: "booking.cancelled_by_maintenance", actorId: owner.id },
    ]);
    expect(await h.prisma.auditLog.count({ where: { entityId: windowId, action: "maintenance.created" } })).toBe(1);

    // The booker sees why on their own booking.
    const detail = await request(h.app).get(`/api/bookings/${early}`).set(student.auth);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      status: "cancelled",
      cancelledByMaintenanceId: windowId,
      cancellation: {
        kind: "maintenance",
        message: expect.stringContaining("Systems Lab was scheduled for maintenance"),
        maintenance: { id: windowId, start: iso("09:30"), end: iso("12:30"), reason: "Projector replacement" },
      },
    });
    const untouched = await request(h.app).get(`/api/bookings/${outside}`).set(student.auth);
    expect(untouched.body.data).toMatchObject({ cancelledByMaintenanceId: null, cancellation: null });

    // The window now blocks new bookings in its time.
    const blocked = await book(student, "11:00", "12:00");
    expect([blocked.status, blocked.body.error.code]).toEqual([409, "MAINTENANCE_BLOCKED"]);
  });

  it("also cancels pending and in-progress bookings, closing an open session at the window's start", async () => {
    const pendingLab = await createResource(h.prisma, {
      departmentId: dept, name: "Seminar Room", requiresApproval: true, ownerIds: [owner.id],
    });
    const pending = await insertBooking(h.prisma, {
      resourceId: pendingLab, userId: student.id, start: new Date(istInstant(TOMORROW, "10:00")), end: new Date(istInstant(TOMORROW, "11:00")), status: "pending",
    });
    // In progress now: checked in 25 minutes ago.
    const running = await insertBooking(h.prisma, {
      resourceId: lab, userId: student.id, start: new Date(NOW.getTime() - 30 * MIN), end: new Date(NOW.getTime() + 30 * MIN), status: "checked_in",
    });
    await insertCheckin(h.prisma, { bookingId: running, in: new Date(NOW.getTime() - 25 * MIN), out: null });

    const windowStart = new Date(NOW.getTime() - 10 * MIN); // the lab broke 10 minutes ago
    const res = await createWindow(owner, { start: windowStart.toISOString(), end: new Date(NOW.getTime() + 60 * MIN).toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.data.cancelledBookingIds).toEqual([running]);
    expect(await statusOf(running)).toBe("cancelled");
    expect(await h.prisma.checkin.findUniqueOrThrow({ where: { bookingId: running } })).toMatchObject({
      checkedOutAt: windowStart,
      checkoutMethod: "manual_override",
      checkoutOverriddenBy: owner.id,
    });

    const res2 = await request(h.app)
      .post("/api/maintenance")
      .set(owner.auth)
      .send({ resourceId: pendingLab, start: iso("09:00"), end: iso("10:30"), reason: "Deep clean" });
    expect(res2.body.data.cancelledBookingIds).toEqual([pending]);
    expect(await statusOf(pending)).toBe("cancelled");
  });

  it("refuses overlapping windows and windows that have already ended", async () => {
    expect((await createWindow(owner, { start: iso("09:00"), end: iso("11:00") })).status).toBe(201);
    const overlap = await createWindow(owner, { start: iso("10:30"), end: iso("12:00") });
    expect([overlap.status, overlap.body.error.code]).toEqual([409, "MAINTENANCE_OVERLAP"]);
    expect((await createWindow(owner, { start: iso("11:00"), end: iso("12:00") })).status).toBe(201); // adjacent is fine

    const past = await createWindow(owner, { start: new Date(NOW.getTime() - 120 * MIN).toISOString(), end: new Date(NOW.getTime() - 60 * MIN).toISOString() });
    expect(past.status).toBe(400);
    expect((await createWindow(owner, { start: iso("13:00"), end: iso("12:00") })).status).toBe(400);
  });
});

describe("removing a maintenance window", () => {
  it("soft-deletes it: the time is bookable again, cancelled bookings stay cancelled", async () => {
    const cancelled = await booked(student, "10:00", "11:00");
    const windowId = (await createWindow(owner, { start: iso("09:00"), end: iso("12:00") })).body.data.id as string;

    const res = await request(h.app).delete(`/api/maintenance/${windowId}`).set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: windowId, removedBy: owner.id });
    expect(res.body.data.removedAt).not.toBeNull();
    expect(await h.prisma.maintenanceWindow.count({ where: { id: windowId } })).toBe(1); // still there

    expect(await statusOf(cancelled)).toBe("cancelled");
    expect((await book(student, "10:00", "11:00")).status).toBe(201);
    // Its time can be scheduled again, too.
    expect((await createWindow(owner, { start: iso("09:00"), end: iso("09:30") })).status).toBe(201);
    expect(await h.prisma.auditLog.count({ where: { entityId: windowId, action: "maintenance.removed" } })).toBe(1);

    const again = await request(h.app).delete(`/api/maintenance/${windowId}`).set(owner.auth);
    expect([again.status, again.body.error.code]).toEqual([409, "INVALID_TRANSITION"]);
  });
});

describe("maintenance permissions", () => {
  it("allows resource owners and admins; hides other departments' resources", async () => {
    const otherDept = await createDepartment(h.prisma, "ECE");
    const outsider = await registerUser(h, { email: "ece@college.edu", departmentId: otherDept, role: "lab_incharge" });
    const admin = await registerUser(h, { email: "admin@college.edu", departmentId: otherDept, role: "admin" });
    const notOwner = await registerUser(h, { email: "fac@college.edu", departmentId: dept, role: "faculty" });

    const denied: [TestUser, number, string][] = [
      [student, 403, "FORBIDDEN"],
      [notOwner, 403, "FORBIDDEN"],
      [outsider, 404, "NOT_FOUND"],
    ];
    for (const [user, status, code] of denied) {
      const res = await createWindow(user, { start: iso("09:00"), end: iso("10:00") });
      expect([res.status, res.body.error?.code]).toEqual([status, code]);
    }
    // Positive controls: the owner, and an admin of any department (as for resource:manage).
    const mine = await createWindow(owner, { start: iso("09:00"), end: iso("10:00") });
    expect(mine.status).toBe(201);
    const admins = await createWindow(admin, { start: iso("11:00"), end: iso("12:00") });
    expect(admins.status).toBe(201);

    for (const [user, status] of [[student, 403], [notOwner, 403], [outsider, 404]] as const) {
      expect((await request(h.app).delete(`/api/maintenance/${mine.body.data.id}`).set(user.auth)).status).toBe(status);
    }
    expect((await request(h.app).delete(`/api/maintenance/${admins.body.data.id}`).set(owner.auth)).status).toBe(200);

    // Anyone who can see the resource can list its upcoming windows.
    const list = await request(h.app).get("/api/maintenance").query({ resourceId: lab }).set(student.auth);
    expect(list.body.data.map((w: { id: string }) => w.id)).toEqual([mine.body.data.id]);
    expect((await request(h.app).get("/api/maintenance").query({ resourceId: lab }).set(outsider.auth)).status).toBe(404);
  });
});

/**
 * The race the resource row lock prevents (§2c): booking creation holds the
 * resource FOR SHARE from its maintenance check through its INSERT, and
 * maintenance creation holds it FOR UPDATE from before its window INSERT
 * through its booking cancellations. Each test pauses one side while it
 * holds its lock and shows the other side is blocked on that lock — not
 * racing past it — and then ends consistently.
 */
describe("maintenance vs. a concurrent booking", () => {
  /** A unit of work whose first transaction pauses right after `pausePoint`. */
  function pausingUow(pausePoint: (tx: TxRepositories, pause: () => Promise<void>) => void) {
    const base: UnitOfWork = createUnitOfWork(h.prisma);
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let armed = true;
    const uow: UnitOfWork = {
      read: base.read,
      transaction: (work) =>
        base.transaction((tx) => {
          if (armed) {
            armed = false;
            pausePoint(tx, async () => {
              reached();
              await released;
            });
          }
          return work(tx);
        }),
    };
    return { uow, paused, release };
  }

  const pausedServices = (uow: UnitOfWork): Services =>
    createServices(h.prisma, testConfig(inject("databaseUrl")), { uow, clock: clock.now });

  const actorOf = async (user: TestUser): Promise<Actor> => {
    const u = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { id: u.id, role: u.role, departmentId: u.departmentId, isActive: u.isActive };
  };

  /** Waits until some backend is blocked waiting for a row lock. */
  async function someoneWaitsOnALock(): Promise<boolean> {
    for (let i = 0; i < 50; i += 1) {
      const [row] = z.array(z.object({ n: z.number() })).parse(
        await h.prisma.$queryRaw`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND datname = current_database()`,
      );
      if ((row?.n ?? 0) > 0) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  const settled = async <T>(p: Promise<T>): Promise<boolean> =>
    Promise.race([p.then(() => true, () => true), new Promise<boolean>((r) => setTimeout(() => r(false), 300))]);

  const slot = { startsAt: istInstant(TOMORROW, "10:00"), endsAt: istInstant(TOMORROW, "11:00") };
  const window = { startsAt: istInstant(TOMORROW, "09:00"), endsAt: istInstant(TOMORROW, "12:00"), reason: "Rewiring" };

  it("a booking already past its maintenance check finishes first, then the window cancels it", async () => {
    // Pause the booking right after it takes the resource FOR SHARE.
    const { uow, paused, release } = pausingUow((tx, pause) => {
      const lockForShare = tx.resources.lockForShare.bind(tx.resources);
      tx.resources.lockForShare = async (id) => {
        await lockForShare(id);
        await pause();
      };
    });
    const bookingDone = pausedServices(uow).bookings.create(await actorOf(student), {
      resourceId: lab, ...slot, purpose: "", attendeeCount: 1, idempotencyKey: "race-1",
    });
    await paused;

    const maintenanceDone = h.services.maintenance.create(await actorOf(owner), { resourceId: lab, ...window });
    expect(await someoneWaitsOnALock()).toBe(true); // maintenance is blocked on FOR UPDATE
    expect(await settled(maintenanceDone)).toBe(false);

    release();
    const { booking } = await bookingDone;
    const { window: created, cancelled } = await maintenanceDone;
    expect(cancelled.map((b) => b.id)).toEqual([booking.id]);
    expect(await h.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({
      status: "cancelled",
      cancelledByMaintenanceId: created.id,
    });
  });

  it("a booking arriving while a window is being created waits, then is refused", async () => {
    // Pause maintenance creation right after inserting the window (resource held FOR UPDATE).
    const { uow, paused, release } = pausingUow((tx, pause) => {
      const insert = tx.maintenance.insert.bind(tx.maintenance);
      tx.maintenance.insert = async (w) => {
        const created = await insert(w);
        await pause();
        return created;
      };
    });
    const maintenanceDone = pausedServices(uow).maintenance.create(await actorOf(owner), { resourceId: lab, ...window });
    await paused;

    const bookingDone = h.services.bookings.create(await actorOf(student), {
      resourceId: lab, ...slot, purpose: "", attendeeCount: 1, idempotencyKey: "race-2",
    });
    expect(await someoneWaitsOnALock()).toBe(true); // the booking is blocked on FOR SHARE
    expect(await settled(bookingDone)).toBe(false);

    release();
    await maintenanceDone;
    const outcome = await bookingDone.then(
      () => null,
      (err: unknown) => err,
    );
    expect(outcome).toBeInstanceOf(DomainError);
    expect(outcome).toMatchObject({ code: "MAINTENANCE_BLOCKED" });
    expect(await h.prisma.booking.count({ where: { resourceId: lab } })).toBe(0);
  });
});
