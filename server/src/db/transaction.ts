import type { Prisma, PrismaClient } from "./prisma.js";

declare const openTransaction: unique symbol;

/**
 * A Prisma client bound to an open interactive transaction.
 *
 * The brand exists because Prisma's root client is structurally assignable to
 * `Prisma.TransactionClient`, so that type alone cannot stop a caller passing
 * the root client where a transaction is required. Only `runInTransaction`
 * produces a `TxClient`, so code typed to accept one is statically guaranteed
 * to execute inside a transaction. Anything relying on transaction-scoped
 * semantics (`pg_advisory_xact_lock`, `SELECT ... FOR UPDATE`) should take it.
 */
export type TxClient = Prisma.TransactionClient & { readonly [openTransaction]: true };

export interface TransactionOptions {
  maxWait: number;
  timeout: number;
}

/** Runs `work` in an interactive transaction. The only place a TxClient is minted. */
export function runInTransaction<T>(
  prisma: PrismaClient,
  work: (tx: TxClient) => Promise<T>,
  options: TransactionOptions,
): Promise<T> {
  return prisma.$transaction((tx) => work(tx as TxClient), options);
}
