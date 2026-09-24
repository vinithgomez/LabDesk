import cron from "node-cron";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signResourceQr } from "../auth/qr-signature.js";
import { jobLockKey, withJobLock } from "../jobs/job-lock.js";
import { JOBS, runLockedJob, type JobDefinition } from "../jobs/scheduler.js";
import {
  createDepartment,
  createHarness,
  createResource,
  createTestClock,
  insertBooking,
  registerUser,
  resetDatabase,
  resetRedis,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

const MIN = 60_000;
const T0 = new Date("2026-10-05T04:30:00.000Z");
const clock = createTestClock(T0);
const at = (offsetMs: number, from: Date = T0) => new Date(from.getTime() + offsetMs);

let h: TestHarness;
let student: TestUser;
let lab: string;

beforeAll(() => {
  h = createHarness({ clock: clock.now });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  clock.set(T0);
  await Promise.all([resetDatabase(h.prisma), resetRedis(h.redis)]);
  const dept = await createDepartment(h.prisma, "CSE");
  student = await registerUser(h, { email: "student@college.edu", departmentId: dept });
  lab = await createResource(h.prisma, { departmentId: dept });
});

const job = (name: string): JobDefinition => {
  const found = JOBS.find((j) => j.name === name);
  if (!found) throw new Error(`no job ${name}`);
  return found;
};
const booking = (status: string, startOffset: number, minutes = 60) =>
  insertBooking(h.prisma, {
    resourceId: lab,
    userId: student.id,
    start: at(startOffset),
    end: at(startOffset + minutes * MIN),
    status,
  });
const statusOf = async (id: string) => (await h.prisma.booking.findUniqueOrThrow({ where: { id } })).status;
const scanIn = async () => {
  const { qrSecret } = await h.prisma.resource.findUniqueOrThrow({ where: { id: lab } });
  const res = await request(h.app)
    .post("/api/checkin")
    .set(student.auth)
    .send({ resourceId: lab, sig: signResourceQr(qrSecret, lab) });
  expect(res.status).toBe(200);
};

/** Everything the jobs may touch, for before/after comparison. */
const snapshot = async () => ({
  bookings: (await h.prisma.booking.findMany({ select: { id: true, status: true, updatedAt: true }, orderBy: { id: "asc" } })),
  checkins: await h.prisma.checkin.findMany({ orderBy: { id: "asc" } }),
  audit: await h.prisma.auditLog.count(),
});

describe("no-show sweeper", () => {
  it("marks a booking no-show only strictly after start + 15 minutes", async () => {
    const id = await booking("approved", 0);

    clock.set(at(15 * MIN));
    expect(await h.services.bookings.runNoShowSweep()).toMatchObject({ changed: 0 });
    expect(await statusOf(id)).toBe("approved");

    clock.set(at(15 * MIN + 1));
    expect(await h.services.bookings.runNoShowSweep()).toMatchObject({ candidates: 1, changed: 1 });
    expect(await statusOf(id)).toBe("no_show");

    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: id, action: "booking.no_show" } });
    expect(audit?.actorId).toBeNull();
    expect(audit?.before).toMatchObject({ status: "approved", checkin: null });
    expect(audit?.after).toMatchObject({ status: "no_show" });
  });

  it("leaves checked-in, pending and future bookings alone", async () => {
    const attended = await booking("approved", 0);
    await scanIn();
    const pending = await booking("pending", 2 * 60 * MIN);
    const future = await booking("approved", 4 * 60 * MIN);

    clock.set(at(3 * 60 * MIN));
    expect(await h.services.bookings.runNoShowSweep()).toMatchObject({ changed: 0 });
    expect([await statusOf(attended), await statusOf(pending), await statusOf(future)]).toEqual([
      "checked_in",
      "pending",
      "approved",
    ]);
  });
});

describe("auto-complete", () => {
  it("closes an unfinished session at its booked end, strictly after end + 15 minutes", async () => {
    const id = await booking("approved", 0);
    await scanIn();
    const end = at(60 * MIN);

    clock.set(at(15 * MIN, end));
    expect(await h.services.bookings.runAutoComplete()).toMatchObject({ changed: 0 });

    clock.set(at(15 * MIN + 1, end));
    expect(await h.services.bookings.runAutoComplete()).toMatchObject({ changed: 1 });
    expect(await statusOf(id)).toBe("completed");
    const checkin = await h.prisma.checkin.findUniqueOrThrow({ where: { bookingId: id } });
    expect(checkin.checkedOutAt?.toISOString()).toBe(end.toISOString()); // the booked end, not the run time
    expect(checkin.checkoutMethod).toBe("auto");

    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: id, action: "booking.auto_completed" } });
    expect(audit?.actorId).toBeNull();
  });
});

describe("lapsed-pending expiry", () => {
  it("rejects a pending booking at its start instant, without writing an approval", async () => {
    const id = await booking("pending", 30 * MIN);

    clock.set(at(30 * MIN - 1));
    expect(await h.services.bookings.runLapsedPendingExpiry()).toMatchObject({ changed: 0 });

    clock.set(at(30 * MIN));
    expect(await h.services.bookings.runLapsedPendingExpiry()).toMatchObject({ changed: 1 });
    expect(await statusOf(id)).toBe("rejected");
    expect(await h.prisma.bookingApproval.count({ where: { bookingId: id } })).toBe(0);
    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: id, action: "booking.expired" } });
    expect(audit?.actorId).toBeNull();
  });
});

describe("idempotency: a second run on the same data changes nothing", () => {
  it.each([
    ["no-show-sweeper", "approved", 16 * MIN],
    ["auto-complete", "checked_in", 76 * MIN],
    ["expire-lapsed-pending", "pending", 1],
  ])("%s", async (name, status, runAfter) => {
    const ids = [await booking(status === "checked_in" ? "approved" : status, 0)];
    if (status === "checked_in") await scanIn();
    ids.push(await booking(status === "checked_in" ? "approved" : status, 2 * 60 * MIN)); // not yet due
    clock.set(at(runAfter));

    const first = await job(name).run(h.services);
    expect(first).toMatchObject({ changed: 1, failed: 0 });
    const afterFirst = await snapshot();

    const second = await job(name).run(h.services);
    expect(second).toEqual({ candidates: 0, changed: 0, skipped: 0, failed: 0 });
    expect(await snapshot()).toEqual(afterFirst);
  });
});

describe("Redis job lock", () => {
  it("lets exactly one of two concurrent sweeper invocations do the work", async () => {
    const due = [await booking("approved", 0), await booking("approved", 2 * 60 * MIN)];
    clock.set(at(3 * 60 * MIN));

    // Hold the winner inside the lock until the loser has made its attempt,
    // so the two genuinely overlap rather than running back to back.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sweeper = job("no-show-sweeper");
    let workerEntries = 0;
    const gated: JobDefinition = {
      ...sweeper,
      run: async (b) => {
        workerEntries += 1;
        await gate;
        return sweeper.run(b);
      },
    };

    const runs = [runLockedJob(h.redis, gated, h.services), runLockedJob(h.redis, gated, h.services)];
    const loser = await Promise.race(runs);
    expect(loser).toEqual({ ran: false });
    expect(await h.redis.get(jobLockKey(sweeper.name))).toMatch(/^[0-9a-f-]{36}$/); // held by the winner
    release();
    const outcomes = await Promise.all(runs);

    const winners = outcomes.filter((o) => o.ran);
    expect(winners).toHaveLength(1);
    expect(workerEntries).toBe(1);
    expect(winners[0]).toMatchObject({ ran: true, result: { candidates: 2, changed: 2, skipped: 0 } });
    expect(await h.prisma.auditLog.count({ where: { action: "booking.no_show" } })).toBe(due.length);
    expect(await h.redis.get(jobLockKey(sweeper.name))).toBeNull(); // released
  });

  it("recovers when a crashed holder's lock expires", async () => {
    await h.redis.set(jobLockKey("no-show-sweeper"), "crashed-run", "PX", 200);
    expect(await runLockedJob(h.redis, job("no-show-sweeper"), h.services)).toEqual({ ran: false });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await runLockedJob(h.redis, job("no-show-sweeper"), h.services)).toMatchObject({ ran: true });
  });

  it("never releases a lock another run has since acquired", async () => {
    const key = jobLockKey("test-job");
    await withJobLock(h.redis, "test-job", 60_000, async () => {
      // Simulate: our TTL lapsed and another run took the lock mid-work.
      await h.redis.set(key, "someone-else", "PX", 60_000);
    });
    expect(await h.redis.get(key)).toBe("someone-else");
  });

  it("uses one lock per job, a valid schedule, and a TTL shorter than the interval", () => {
    expect(new Set(JOBS.map((j) => j.name)).size).toBe(JOBS.length);
    for (const j of JOBS) {
      expect(cron.validate(j.cron)).toBe(true);
      // "*/N * * * *" runs every N minutes; "M H * * *" runs once a day.
      const everyN = /^\*\/(\d+) \* \* \* \*$/.exec(j.cron)?.[1];
      const daily = /^\d+ \d+ \* \* \*$/.test(j.cron);
      expect(everyN !== undefined || daily, `${j.name}: unrecognised schedule ${j.cron}`).toBe(true);
      const intervalMin = everyN !== undefined ? Number(everyN) : 24 * 60;
      expect(j.ttlMs).toBeLessThan(intervalMin * MIN);
    }
  });
});
