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
    await runInTransaction(
      h.prisma,
      async (tx) => {
        await new BookingWriter(tx).insert({
          resourceId,
          userId: user.id,
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          purpose: "",
          attendeeCount: 1,
          idempotencyKey: null,
        });
        heldDuringTransaction = await advisoryLocksHeld();
      },
      TRANSACTION_OPTIONS,
    );

    expect(heldDuringTransaction).toBe(1);
    expect(await advisoryLocksHeld()).toBe(0);
  });

  it("is released immediately when taken outside a transaction (the hazard)", async () => {
    // Exactly what insert would do if it could run on the root client: the
    // lock lives only for this one statement's implicit transaction.
    await h.prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"any-resource"}::text, 0))`;
    expect(await advisoryLocksHeld()).toBe(0);
  });
});
