import type { Server } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { z } from "zod";
import { createApp } from "../app.js";
import { createServices } from "../container.js";
import { createPrismaClient, type PrismaClient } from "../db/prisma.js";
import { createLogger } from "../lib/logger.js";
import { BookingRepository } from "../repositories/booking.repository.js";
import {
  createRepositories,
  createTxRepositories,
  TRANSACTION_OPTIONS,
  type UnitOfWork,
} from "../repositories/index.js";
import {
  createDepartment,
  createHarness,
  registerUser,
  resetDatabase,
  testConfig,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

const PARTIES = 50;

/**
 * All parties block in `arrive()` until the last one arrives. `beforeRelease`
 * runs once, while every party is still parked, so the test can observe the
 * database at the moment of maximum contention. A timeout turns a broken
 * barrier into a failure instead of a hang.
 */
function createBarrier(parties: number, timeoutMs: number, beforeRelease: () => Promise<void>) {
  let arrived = 0;
  let release!: () => void;
  let fail!: (err: Error) => void;
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  gate.catch(() => undefined);
  const timer = setTimeout(() => fail(new Error(`barrier timed out: ${arrived}/${parties} arrived`)), timeoutMs);

  return {
    async arrive(): Promise<void> {
      arrived += 1;
      if (arrived === parties) {
        clearTimeout(timer);
        beforeRelease().then(release, fail);
      }
      await gate;
    },
  };
}

/** Tomorrow 10:00–11:00 IST: same IST day, 60 minutes, inside any sane horizon. */
function tomorrowSlotIST(): { start: string; end: string } {
  const istDate = new Date(Date.now() + 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
  return { start: `${istDate}T10:00:00+05:30`, end: `${istDate}T11:00:00+05:30` };
}

let h: TestHarness;
let contended: PrismaClient;
let observer: PrismaClient;

beforeAll(() => {
  h = createHarness();
  // A pool large enough that all 50 transactions hold their own connection.
  contended = createPrismaClient(`${inject("databaseUrl")}&connection_limit=${PARTIES + 5}&pool_timeout=30`);
  observer = createPrismaClient(`${inject("databaseUrl")}&connection_limit=1`);
});
afterAll(async () => {
  await Promise.all([h.close(), contended.$disconnect(), observer.$disconnect()]);
});
beforeEach(async () => {
  await resetDatabase(h.prisma);
});

describe("booking concurrency", () => {
  it(
    "lets exactly one of 50 truly concurrent bookings for the same slot succeed",
    async () => {
      const deptId = await createDepartment(h.prisma, "CSE");
      const resource = await h.prisma.resource.create({
        data: {
          departmentId: deptId,
          name: "Contended Lab",
          type: "lab",
          location: "A-101",
          capacity: 60,
          minSlotMinutes: 30,
          maxSlotMinutes: 180,
          bookingHorizonDays: 14,
        },
      });

      // 50 distinct students (registered through the normal app), one attempt each.
      const students: TestUser[] = [];
      for (let i = 0; i < PARTIES; i += 1) {
        students.push(await registerUser(h, { email: `student${i}@college.edu`, departmentId: deptId }));
      }

      // Evidence gathered while every transaction is parked at the barrier.
      const backendPids = new Set<number>();
      let openTransactionsAtRelease = -1;
      let committedBookingsAtRelease = -1;

      const barrier = createBarrier(PARTIES, 20_000, async () => {
        const [activity] = z
          .array(z.object({ open: z.number() }))
          .parse(
            await observer.$queryRaw`
              SELECT count(*)::int AS open FROM pg_stat_activity
              WHERE datname = current_database() AND state = 'idle in transaction'`,
          );
        openTransactionsAtRelease = activity?.open ?? -1;
        committedBookingsAtRelease = await observer.$executeRaw`SELECT 1 FROM bookings`;
      });

      // The production unit of work, except that each transaction records its
      // backend PID and parks at the barrier immediately before the INSERT.
      const barrierUow: UnitOfWork = {
        read: createRepositories(contended),
        transaction: (work) =>
          contended.$transaction(async (txClient) => {
            const [row] = z
              .array(z.object({ pid: z.number() }))
              .parse(await txClient.$queryRaw`SELECT pg_backend_pid() AS pid`);
            if (row) backendPids.add(row.pid);

            const gated = new BookingRepository(txClient);
            const insert = gated.insert.bind(gated);
            gated.insert = async (booking) => {
              await barrier.arrive();
              return insert(booking);
            };
            return work({ ...createTxRepositories(txClient), bookings: gated });
          }, TRANSACTION_OPTIONS),
      };

      const config = testConfig(inject("databaseUrl"));
      const app = createApp({
        config,
        logger: createLogger("silent"),
        services: createServices(contended, config, { uow: barrierUow }),
      });
      const server: Server = app.listen(0);

      try {
        const slot = tomorrowSlotIST();
        const responses = await Promise.all(
          students.map((s, i) =>
            request(server)
              .post("/api/bookings")
              .set(s.auth)
              .set("Idempotency-Key", `concurrency-${i}`)
              .send({ resourceId: resource.id, start: slot.start, end: slot.end, purpose: "contention" }),
          ),
        );

        // The contention was real: 50 separate connections, all inside an
        // open transaction, none committed, at the instant of release.
        expect(backendPids.size).toBe(PARTIES);
        expect(openTransactionsAtRelease).toBeGreaterThanOrEqual(PARTIES);
        expect(committedBookingsAtRelease).toBe(0);

        const created = responses.filter((r) => r.status === 201);
        const conflicts = responses.filter((r) => r.status === 409 && r.body?.error?.code === "SLOT_CONFLICT");
        expect({ created: created.length, conflicts: conflicts.length }).toEqual({ created: 1, conflicts: PARTIES - 1 });

        const [stored] = z
          .array(z.object({ n: z.number() }))
          .parse(
            await h.prisma.$queryRaw`
              SELECT count(*)::int AS n FROM bookings
              WHERE resource_id = ${resource.id}::uuid
                AND period = tstzrange(${slot.start}::timestamptz, ${slot.end}::timestamptz, '[)')`,
          );
        expect(stored?.n).toBe(1);
      } finally {
        server.close();
      }
    },
    90_000,
  );
});
