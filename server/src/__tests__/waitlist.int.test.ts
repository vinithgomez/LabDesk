import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { istInstant } from "../domain/booking-rules.js";
import { DomainError } from "../domain/errors.js";
import { jobLockKey } from "../jobs/job-lock.js";
import { JOBS, runLockedJob, type JobDefinition } from "../jobs/scheduler.js";
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

// Monday 5 Oct 2026, 10:00 IST. The lab takes 30–120 minute slots, 7 days ahead.
const T0 = new Date("2026-10-05T04:30:00.000Z");
const DAY = "2026-10-05";
const clock = createTestClock(T0);
const at = (hhmm: string) => istInstant(DAY, hhmm);
const period = (from: string, to: string) => ({ start: at(from).toISOString(), end: at(to).toISOString() });

let h: TestHarness;
let dept: string;
let lab: string;
let holder: TestUser;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

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
  [holder, alice, bob, carol] = await Promise.all(
    ["holder", "alice", "bob", "carol"].map((n) => registerUser(h, { email: `${n}@college.edu`, departmentId: dept })),
  ) as [TestUser, TestUser, TestUser, TestUser];
  lab = await createResource(h.prisma, { departmentId: dept });
});

const hold = async (user: TestUser, p: { start: string; end: string }, resourceId = lab): Promise<string> => {
  const res = await book(h, user, { resourceId, ...p });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
};
const join = (user: TestUser, p: { start: string; end: string }, extra: Record<string, unknown> = {}) =>
  request(h.app).post("/api/waitlist").set(user.auth).send({ resourceId: lab, desiredPeriod: p, ...extra });
const joined = async (user: TestUser, p: { start: string; end: string }): Promise<string> => {
  const res = await join(user, p);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
};
const cancelBooking = async (user: TestUser, id: string) => {
  const res = await request(h.app).post(`/api/bookings/${id}/cancel`).set(user.auth);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const entry = (id: string) => h.prisma.waitlistEntry.findUniqueOrThrow({ where: { id } });
const statusOf = async (id: string) => (await entry(id)).status;

/** Slot-holding bookings on the lab overlapping [from, to). */
async function heldOverlapping(from: string, to: string): Promise<{ id: string; userId: string }[]> {
  return z.array(z.object({ id: z.string(), userId: z.string() })).parse(
    await h.prisma.$queryRaw`
      SELECT id::text AS id, user_id::text AS "userId" FROM bookings
      WHERE resource_id = ${lab}::uuid
        AND status IN ('pending', 'approved', 'checked_in')
        AND period && tstzrange(${at(from).toISOString()}::timestamptz, ${at(to).toISOString()}::timestamptz, '[)')
      ORDER BY lower(period)`,
  );
}

describe("joining the waitlist", () => {
  it("is only for a slot someone holds: a free slot is SLOT_AVAILABLE", async () => {
    const free = await join(alice, period("11:00", "12:00"));
    expect(free.status).toBe(409);
    expect(free.body.error.code).toBe("SLOT_AVAILABLE");

    await hold(holder, period("11:30", "12:30"));
    const res = await join(alice, period("11:00", "12:00"), { purpose: "DSP lab", attendeeCount: 3 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      resourceId: lab,
      userId: alice.id,
      desiredPeriod: period("11:00", "12:00"),
      purpose: "DSP lab",
      attendeeCount: 3,
      status: "waiting",
      bookingId: null,
    });
    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: res.body.data.id, action: "waitlist.joined" } });
    expect(audit?.actorId).toBe(alice.id);
  });

  it("applies the booking rules to the desired period", async () => {
    await hold(holder, period("11:00", "12:00"));
    await createMaintenanceWindow(h.prisma, { resourceId: lab, ...period("14:00", "15:00"), createdBy: holder.id });
    await hold(holder, period("13:30", "14:00"));

    const cases: [{ start: string; end: string }, string][] = [
      [period("10:30", "13:00"), "SLOT_TOO_LONG"], // 150 > 120 minutes
      [period("09:00", "11:30"), "SLOT_TOO_LONG"],
      [period("09:30", "11:00"), "OUTSIDE_HORIZON"], // starts before now (10:00)
      [period("13:30", "14:30"), "MAINTENANCE_BLOCKED"],
    ];
    for (const [p, code] of cases) {
      const res = await join(alice, p);
      expect({ p, code: res.body.error?.code }).toEqual({ p, code });
    }
    const multiDay = await join(alice, { start: at("23:30").toISOString(), end: istInstant("2026-10-06", "00:30").toISOString() });
    expect(multiDay.body.error.code).toBe("MULTI_DAY_NOT_SUPPORTED");
    expect((await join(alice, period("11:00", "12:00"), { role: "admin" })).status).toBe(400);
  });

  it("allows one waiting entry per user per overlapping period", async () => {
    await hold(holder, period("11:00", "12:00"));
    const first = await joined(alice, period("11:00", "12:00"));

    for (const p of [period("11:00", "12:00"), period("11:30", "12:00")]) {
      const dup = await join(alice, p);
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe("WAITLIST_DUPLICATE");
    }
    expect((await join(bob, period("11:00", "12:00"))).status).toBe(201); // someone else: fine

    await request(h.app).delete(`/api/waitlist/${first}`).set(alice.auth).expect(200);
    expect((await join(alice, period("11:00", "12:00"))).status).toBe(201); // a cancelled entry doesn't count
  });

  it("keeps entries private to their owner", async () => {
    await hold(holder, period("11:00", "12:00"));
    const mine = await joined(alice, period("11:00", "12:00"));
    await joined(bob, period("11:00", "12:00"));

    const theirs = await request(h.app).delete(`/api/waitlist/${mine}`).set(bob.auth);
    expect(theirs.status).toBe(404);
    expect(await statusOf(mine)).toBe("waiting");

    const list = await request(h.app).get("/api/waitlist").set(alice.auth).expect(200);
    expect(list.body.data.map((e: { id: string }) => e.id)).toEqual([mine]);

    const otherDept = await createDepartment(h.prisma, "ECE");
    const outsider = await registerUser(h, { email: "ece@college.edu", departmentId: otherDept });
    const hidden = await join(outsider, period("11:00", "12:00"));
    expect(hidden.status).toBe(404);
  });

  it("cancels a waiting entry once, audited", async () => {
    await hold(holder, period("11:00", "12:00"));
    const id = await joined(alice, period("11:00", "12:00"));

    const res = await request(h.app).delete(`/api/waitlist/${id}`).set(alice.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: id, action: "waitlist.cancelled" } });
    expect(audit?.actorId).toBe(alice.id);

    const again = await request(h.app).delete(`/api/waitlist/${id}`).set(alice.auth);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("waitlist promoter", () => {
  it("promotes in FIFO order: the oldest entry gets the freed slot, the rest keep waiting", async () => {
    const held = await hold(holder, period("11:00", "12:00"));
    const a = await joined(alice, period("11:00", "12:00"));
    const b = await joined(bob, period("11:00", "12:00"));
    const c = await joined(carol, period("11:30", "12:00"));
    await cancelBooking(holder, held);

    expect(await h.services.waitlist.runPromotion()).toEqual({ candidates: 3, promoted: 1, blocked: 2, failed: 0 });
    expect([await statusOf(a), await statusOf(b), await statusOf(c)]).toEqual(["promoted", "waiting", "waiting"]);

    const promoted = await entry(a);
    const [booking] = await heldOverlapping("11:00", "12:00");
    expect(booking).toEqual({ id: promoted.bookingId, userId: alice.id });
    expect(await h.prisma.booking.findUniqueOrThrow({ where: { id: booking!.id } })).toMatchObject({
      status: "approved", // this lab doesn't require approval
      seriesId: null,
    });
    // booking.created and waitlist.promoted share a transaction (and so a created_at).
    const audits = await h.prisma.auditLog.findMany({
      where: { entityId: { in: [a, booking!.id] } },
      select: { action: true, actorId: true },
    });
    expect(audits).toHaveLength(3);
    expect(audits).toEqual(
      expect.arrayContaining([
        { action: "waitlist.joined", actorId: alice.id },
        { action: "booking.created", actorId: null },
        { action: "waitlist.promoted", actorId: null },
      ]),
    );

    // Alice gives it up: next in line is Bob, then Carol (whose half-slot overlaps Bob's).
    await cancelBooking(alice, booking!.id);
    expect(await h.services.waitlist.runPromotion()).toMatchObject({ promoted: 1, blocked: 1 });
    expect([await statusOf(b), await statusOf(c)]).toEqual(["promoted", "waiting"]);
  });

  it("does not let an older entry whose period is still partly held block a newer one that fits", async () => {
    await hold(holder, period("10:30", "11:30"));
    const second = await hold(holder, period("11:30", "12:30"));
    const older = await joined(alice, period("10:30", "12:30"));
    const newer = await joined(bob, period("11:30", "12:30"));
    await cancelBooking(holder, second);

    expect(await h.services.waitlist.runPromotion()).toEqual({ candidates: 1, promoted: 1, blocked: 0, failed: 0 });
    expect([await statusOf(older), await statusOf(newer)]).toEqual(["waiting", "promoted"]);
  });

  it("creates the booking 'pending' on a resource that requires approval: promotion is not approval", async () => {
    const owner = await registerUser(h, { email: "owner@college.edu", departmentId: dept, role: "faculty" });
    const gated = await createResource(h.prisma, { departmentId: dept, requiresApproval: true, ownerIds: [owner.id] });
    const held = await hold(holder, period("11:00", "12:00"), gated);
    const res = await request(h.app)
      .post("/api/waitlist")
      .set(alice.auth)
      .send({ resourceId: gated, desiredPeriod: period("11:00", "12:00") });
    expect(res.status).toBe(201);

    // The slot frees by rejection this time.
    await request(h.app).post(`/api/bookings/${held}/reject`).set(owner.auth).send({}).expect(200);
    expect(await h.services.waitlist.runPromotion()).toMatchObject({ promoted: 1 });

    const promoted = await entry(res.body.data.id);
    const booking = await h.prisma.booking.findUniqueOrThrow({ where: { id: promoted.bookingId! } });
    expect(booking).toMatchObject({ userId: alice.id, status: "pending" });
    expect(await h.prisma.bookingApproval.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it("waits while a maintenance window covers the slot, and promotes once it is removed", async () => {
    const held = await hold(holder, period("11:00", "12:00"));
    const a = await joined(alice, period("11:00", "12:00"));
    await createMaintenanceWindow(h.prisma, { resourceId: lab, ...period("11:30", "12:00"), createdBy: holder.id });
    await cancelBooking(holder, held);

    expect(await h.services.waitlist.runPromotion()).toEqual({ candidates: 0, promoted: 0, blocked: 0, failed: 0 });
    expect(await statusOf(a)).toBe("waiting");

    await h.prisma.$executeRaw`DELETE FROM maintenance_windows WHERE resource_id = ${lab}::uuid`;
    expect(await h.services.waitlist.runPromotion()).toMatchObject({ promoted: 1 });
    expect(await statusOf(a)).toBe("promoted");
  });

  it("is idempotent: a second run on the same data changes nothing", async () => {
    const held = await hold(holder, period("11:00", "12:00"));
    await joined(alice, period("11:00", "12:00"));
    await joined(bob, period("11:00", "12:00"));
    await cancelBooking(holder, held);
    const snapshot = async () => ({
      bookings: await h.prisma.booking.findMany({ select: { id: true, status: true, updatedAt: true }, orderBy: { id: "asc" } }),
      entries: await h.prisma.waitlistEntry.findMany({ orderBy: { id: "asc" } }),
      audit: await h.prisma.auditLog.count(),
    });

    expect(await h.services.waitlist.runPromotion()).toMatchObject({ promoted: 1 });
    const afterFirst = await snapshot();
    expect(await h.services.waitlist.runPromotion()).toEqual({ candidates: 0, promoted: 0, blocked: 0, failed: 0 });
    expect(await snapshot()).toEqual(afterFirst);
  });
});

describe("promotion goes through the exclusion constraint", () => {
  /** Two waiting entries overlapping each other, over a slot that has just freed. */
  async function twoOverlappingEntriesOverAFreedSlot(): Promise<[string, string]> {
    const held = await hold(holder, period("11:00", "12:30"));
    const a = await joined(alice, period("11:00", "12:00"));
    const b = await joined(bob, period("11:30", "12:30"));
    await cancelBooking(holder, held);
    return [a, b];
  }

  it("books exactly one of two overlapping entries promoted at the same time", async () => {
    const [a, b] = await twoOverlappingEntriesOverAFreedSlot();

    // Both fire at once, bypassing the job lock and the FIFO ordering.
    const outcomes = await Promise.allSettled([h.services.waitlist.promote(a), h.services.waitlist.promote(b)]);

    const won = outcomes.filter((o) => o.status === "fulfilled");
    const lost = outcomes.flatMap((o) => (o.status === "rejected" ? [o.reason] : []));
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]).toBeInstanceOf(DomainError);
    expect(lost[0]).toMatchObject({ code: "SLOT_CONFLICT" });

    expect(await heldOverlapping("11:00", "12:30")).toHaveLength(1);
    expect((await Promise.all([statusOf(a), statusOf(b)])).sort()).toEqual(["promoted", "waiting"]);
  });

  it("control: without the constraint, both promotions succeed and the slot is double-booked", async () => {
    await h.prisma.$executeRawUnsafe(`ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlap"`);
    try {
      const [a, b] = await twoOverlappingEntriesOverAFreedSlot();
      const outcomes = await Promise.allSettled([h.services.waitlist.promote(a), h.services.waitlist.promote(b)]);

      // Nothing else in the promotion path checks overlap: the constraint is the only guard.
      expect(outcomes.map((o) => o.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(await heldOverlapping("11:00", "12:30")).toHaveLength(2);
    } finally {
      await resetDatabase(h.prisma);
      await h.prisma.$executeRawUnsafe(`
        ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
        EXCLUDE USING gist ("resource_id" WITH =, "period" WITH &&)
        WHERE ("status" IN ('pending', 'approved', 'checked_in'))`);
    }
  });
});

describe("waitlist expiry", () => {
  it("expires a waiting entry at exactly its desired start, not a millisecond before", async () => {
    await hold(holder, period("11:00", "12:00"));
    const a = await joined(alice, period("11:00", "12:00"));

    clock.set(new Date(at("11:00").getTime() - 1));
    expect(await h.services.waitlist.runExpiry()).toMatchObject({ changed: 0 });
    expect(await statusOf(a)).toBe("waiting");

    clock.set(at("11:00"));
    expect(await h.services.waitlist.runExpiry()).toEqual({ candidates: 1, changed: 1, skipped: 0, failed: 0 });
    expect(await statusOf(a)).toBe("expired");
    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: a, action: "waitlist.expired" } });
    expect(audit?.actorId).toBeNull();
    expect(audit?.before).toMatchObject({ status: "waiting" });

    expect(await h.services.waitlist.runExpiry()).toEqual({ candidates: 0, changed: 0, skipped: 0, failed: 0 });
  });

  it("hands the boundary instant to expiry, never to promotion", async () => {
    const held = await hold(holder, period("11:00", "12:00"));
    const a = await joined(alice, period("11:00", "12:00"));
    await cancelBooking(holder, held);

    clock.set(at("11:00"));
    expect(await h.services.waitlist.runPromotion()).toMatchObject({ candidates: 0 });
    expect(await h.services.waitlist.runExpiry()).toMatchObject({ changed: 1 });
    expect(await statusOf(a)).toBe("expired");
  });

  it("still promotes a millisecond before the desired start", async () => {
    const held = await hold(holder, period("11:00", "12:00"));
    const a = await joined(alice, period("11:00", "12:00"));
    await cancelBooking(holder, held);

    clock.set(new Date(at("11:00").getTime() - 1));
    expect(await h.services.waitlist.runPromotion()).toMatchObject({ promoted: 1 });
    expect(await statusOf(a)).toBe("promoted");
  });
});

describe("waitlist promoter Redis lock", () => {
  const promoter = (): JobDefinition => {
    const found = JOBS.find((j) => j.name === "waitlist-promoter");
    if (!found) throw new Error("waitlist-promoter is not scheduled");
    return found;
  };

  it("has its own lock key and a companion expiry job", () => {
    expect(JOBS.map((j) => j.name)).toEqual(expect.arrayContaining(["waitlist-promoter", "waitlist-expiry"]));
    expect(jobLockKey(promoter().name)).toBe("lock:waitlist-promoter");
  });

  it("lets exactly one of two concurrent promoter invocations do the work", async () => {
    const heldA = await hold(holder, period("11:00", "12:00"));
    const heldB = await hold(holder, period("14:00", "15:00"));
    await joined(alice, period("11:00", "12:00"));
    await joined(bob, period("14:00", "15:00"));
    await cancelBooking(holder, heldA);
    await cancelBooking(holder, heldB);

    // Hold the winner inside the lock until the loser has made its attempt,
    // so the two genuinely overlap rather than running back to back.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let workerEntries = 0;
    const job = promoter();
    const gated: JobDefinition = {
      ...job,
      run: async (s) => {
        workerEntries += 1;
        await gate;
        return job.run(s);
      },
    };

    const runs = [runLockedJob(h.redis, gated, h.services), runLockedJob(h.redis, gated, h.services)];
    const loser = await Promise.race(runs);
    expect(loser).toEqual({ ran: false });
    expect(await h.redis.get(jobLockKey(job.name))).toMatch(/^[0-9a-f-]{36}$/); // held by the winner
    release();
    const outcomes = await Promise.all(runs);

    const winners = outcomes.filter((o) => o.ran);
    expect(winners).toHaveLength(1);
    expect(workerEntries).toBe(1);
    expect(winners[0]).toMatchObject({ ran: true, result: { candidates: 2, promoted: 2, blocked: 0, failed: 0 } });
    expect(await h.prisma.auditLog.count({ where: { action: "waitlist.promoted" } })).toBe(2);
    expect(await h.prisma.booking.count({ where: { userId: { in: [alice.id, bob.id] } } })).toBe(2);
    expect(await h.redis.get(jobLockKey(job.name))).toBeNull(); // released
  });
});
