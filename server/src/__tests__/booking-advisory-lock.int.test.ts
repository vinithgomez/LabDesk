import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runInTransaction } from "../db/transaction.js";
import { BookingWriter } from "../repositories/booking.repository.js";
import { TRANSACTION_OPTIONS } from "../repositories/index.js";
import {
  createDepartment,
  createHarness,
  createResource,
  istSlot,
  registerUser,
  resetDatabase,
  type TestHarness,
} from "../test/harness.js";

let h: TestHarness;

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma);
});

/** Advisory locks currently held by any backend, observed from a separate pooled connection. */
async function advisoryLocksHeld(): Promise<number> {
  const [row] = z
    .array(z.object({ n: z.number() }))
    .parse(await h.prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted`);
  return row?.n ?? -1;
}

/**
 * The key of the single advisory lock held right now, as pg_locks reports it.
 * The two-argument (int4, int4) form shows classid = first key, objid =
 * second key, objsubid = 2; the one-argument bigint form shows objsubid = 1.
 * classid/objid are unsigned oids, so they are compared as text.
 */
async function heldAdvisoryKey(): Promise<{ classid: string; objid: string; objsubid: number } | undefined> {
  const [row] = z
    .array(z.object({ classid: z.string(), objid: z.string(), objsubid: z.number() }))
    .parse(
      await h.prisma.$queryRaw`
        SELECT classid::text AS classid, objid::text AS objid, objsubid::int AS objsubid
        FROM pg_locks WHERE locktype = 'advisory' AND granted`,
    );
  return row;
}

/**
 * The premise behind requiring a TxClient for BookingWriter.insert
 * (see booking-insert-requires-tx.test-d.ts for the compile-time half).
 */
describe("per-resource booking advisory lock", () => {
  it("is held by insert until its transaction ends", async () => {
    const dept = await createDepartment(h.prisma, "CSE");
    const user = await registerUser(h, { email: "s@college.edu", departmentId: dept });
    const resourceId = await createResource(h.prisma, { departmentId: dept });
    const slot = istSlot(1, "10:00", "11:00");

    let heldDuringTransaction = -1;
    let keyDuringTransaction: Awaited<ReturnType<typeof heldAdvisoryKey>>;
    await runInTransaction(
      h.prisma,
      async (tx) => {
        await new BookingWriter(tx).insert({
          initialStatus: "pending",
          resourceId,
          userId: user.id,
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          purpose: "",
          attendeeCount: 1,
          idempotencyKey: null,
          seriesId: null,
        });
        heldDuringTransaction = await advisoryLocksHeld();
        keyDuringTransaction = await heldAdvisoryKey();
      },
      TRANSACTION_OPTIONS,
    );

    expect(heldDuringTransaction).toBe(1);
    expect(await advisoryLocksHeld()).toBe(0);

    // Namespaced two-argument form: (19524, hashtext(resource_id::text)).
    // The int4 hash is stored as an unsigned oid, hence the modular mapping.
    const [expected] = z
      .array(z.object({ objid: z.string() }))
      .parse(
        await h.prisma.$queryRaw`
          SELECT ((hashtext(${resourceId}::text)::int8 + 4294967296) % 4294967296)::text AS objid`,
      );
    expect(keyDuringTransaction).toEqual({ classid: String(0x4c44), objid: expected?.objid, objsubid: 2 });
  });

  it("is released immediately when taken outside a transaction (the hazard)", async () => {
    // Exactly what insert would do if it could run on the root client: the
    // lock lives only for this one statement's implicit transaction.
    await h.prisma.$executeRaw`SELECT pg_advisory_xact_lock(${0x4c44}::int4, hashtext(${"any-resource"}::text))`;
    expect(await advisoryLocksHeld()).toBe(0);
  });
});
