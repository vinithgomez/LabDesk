/**
 * Type-level tests (vitest typecheck): these are compiled, never executed.
 *
 * BookingWriter.insert takes pg_advisory_xact_lock. Outside a transaction that
 * lock is released as soon as its statement ends, silently restoring the
 * deadlock behaviour under load. So insert must be unreachable without a
 * transaction, and every misuse below must be a compile error. If one ever
 * compiles, its @ts-expect-error becomes unused and this file fails.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { PrismaClient } from "../db/prisma.js";
import { runInTransaction, type TxClient } from "../db/transaction.js";
import { BookingWriter } from "../repositories/booking.repository.js";
import {
  createRepositories,
  createTxRepositories,
  type Repositories,
  type TxRepositories,
  type UnitOfWork,
} from "../repositories/index.js";

declare const prisma: PrismaClient;
declare const uow: UnitOfWork;

describe("booking insert outside a transaction", () => {
  it("is not exposed on the non-transactional repositories", () => {
    // @ts-expect-error uow.read.bookings is a BookingReader: no insert
    void uow.read.bookings.insert;
    // @ts-expect-error same for repositories built directly on the root client
    void createRepositories(prisma).bookings.insert;
    expectTypeOf<Repositories["bookings"]>().not.toHaveProperty("insert");
    expectTypeOf<Repositories["bookings"]>().not.toHaveProperty("lockById");
    expectTypeOf<Repositories["bookings"]>().not.toHaveProperty("updateStatus");
  });

  it("cannot be reached by building a writer from the root client", () => {
    // @ts-expect-error the root PrismaClient is not a TxClient
    new BookingWriter(prisma);
    // @ts-expect-error nor can transaction-scoped repositories be faked from it
    createTxRepositories(prisma);
    expectTypeOf<PrismaClient>().not.toMatchTypeOf<TxClient>();
  });
});

describe("booking insert inside a transaction (control)", () => {
  it("is available on transaction-scoped repositories", () => {
    expectTypeOf<TxRepositories["bookings"]>().toEqualTypeOf<BookingWriter>();
    expectTypeOf<TxRepositories["bookings"]>().toHaveProperty("insert");
    void uow.transaction(async (tx) => {
      expectTypeOf(tx.bookings.insert).toBeFunction();
    });
    void runInTransaction(
      prisma,
      async (tx) => {
        expectTypeOf(new BookingWriter(tx).insert).toBeFunction();
      },
      { maxWait: 1, timeout: 1 },
    );
  });
});
