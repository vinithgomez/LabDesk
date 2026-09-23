/**
 * Type-level tests (vitest typecheck): these are compiled, never executed.
 *
 * users.lockById, resources.lockById and resources.lockForShare take row
 * locks (FOR UPDATE / FOR SHARE). Outside a transaction those locks are
 * released as soon as their statement ends, so the "before" snapshot they
 * protect, or the booking-vs-deactivation ordering, silently stops being
 * protected. They must be unreachable without a transaction, and every misuse
 * below must be a compile error. If one ever compiles, its @ts-expect-error
 * becomes unused and this file fails. Companion to
 * booking-insert-requires-tx.test-d.ts.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { PrismaClient } from "../db/prisma.js";
import { runInTransaction } from "../db/transaction.js";
import {
  createRepositories,
  type Repositories,
  type TxRepositories,
  type UnitOfWork,
} from "../repositories/index.js";
import { ResourceWriter } from "../repositories/resource.repository.js";
import { UserWriter } from "../repositories/user.repository.js";

declare const prisma: PrismaClient;
declare const uow: UnitOfWork;

describe("row locks outside a transaction", () => {
  it("are not exposed on the non-transactional user repository", () => {
    // @ts-expect-error uow.read.users is a UserReader: no lockById
    void uow.read.users.lockById;
    // @ts-expect-error same for repositories built directly on the root client
    void createRepositories(prisma).users.lockById;
    expectTypeOf<Repositories["users"]>().not.toHaveProperty("lockById");
  });

  it("are not exposed on the non-transactional resource repository", () => {
    // @ts-expect-error uow.read.resources is a ResourceReader: no lockById
    void uow.read.resources.lockById;
    // @ts-expect-error ...and no lockForShare
    void uow.read.resources.lockForShare;
    // @ts-expect-error same for repositories built directly on the root client
    void createRepositories(prisma).resources.lockForShare;
    expectTypeOf<Repositories["resources"]>().not.toHaveProperty("lockById");
    expectTypeOf<Repositories["resources"]>().not.toHaveProperty("lockForShare");
  });

  it("cannot be reached by building a writer from the root client", () => {
    // @ts-expect-error the root PrismaClient is not a TxClient
    new UserWriter(prisma);
    // @ts-expect-error the root PrismaClient is not a TxClient
    new ResourceWriter(prisma);
  });

  it("takes the writes that must commit with their audit row off the reader too", () => {
    expectTypeOf<Repositories["users"]>().not.toHaveProperty("updateRole");
    expectTypeOf<Repositories["users"]>().not.toHaveProperty("create");
    expectTypeOf<Repositories["resources"]>().not.toHaveProperty("create");
    expectTypeOf<Repositories["resources"]>().not.toHaveProperty("update");
  });
});

describe("row locks inside a transaction (control)", () => {
  it("are available on transaction-scoped repositories", () => {
    expectTypeOf<TxRepositories["users"]>().toEqualTypeOf<UserWriter>();
    expectTypeOf<TxRepositories["resources"]>().toEqualTypeOf<ResourceWriter>();
    void uow.transaction(async (tx) => {
      expectTypeOf(tx.users.lockById).toBeFunction();
      expectTypeOf(tx.resources.lockById).toBeFunction();
      expectTypeOf(tx.resources.lockForShare).toBeFunction();
    });
    void runInTransaction(
      prisma,
      async (tx) => {
        expectTypeOf(new UserWriter(tx).lockById).toBeFunction();
        expectTypeOf(new ResourceWriter(tx).lockForShare).toBeFunction();
      },
      { maxWait: 1, timeout: 1 },
    );
  });
});
