import type { DbClient, PrismaClient } from "../db/prisma.js";
import { runInTransaction, type TxClient } from "../db/transaction.js";
import type { AuditEntry } from "../domain/audit.js";
import { AuditRepository } from "./audit.repository.js";
import { BookingReader, BookingWriter } from "./booking.repository.js";
import { DepartmentRepository } from "./department.repository.js";
import { MaintenanceRepository } from "./maintenance.repository.js";
import { RefreshTokenRepository } from "./refresh-token.repository.js";
import { ResourceRepository } from "./resource.repository.js";
import { UserRepository } from "./user.repository.js";

export interface Repositories {
  departments: DepartmentRepository;
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  resources: ResourceRepository;
  /** Read-only here: booking writes need a transaction (see TxRepositories). */
  bookings: BookingReader;
  maintenance: MaintenanceRepository;
}

/**
 * Repositories bound to an open transaction. Two capabilities exist only
 * here — never on `uow.read` — so misuse is a compile error:
 *  - `writeAudit`: an audit row is always written in the same transaction as
 *    the mutation it records, and rolls back with it.
 *  - `bookings` is a BookingWriter: `insert` relies on a transaction-scoped
 *    advisory lock that would silently do nothing outside a transaction.
 */
export interface TxRepositories extends Repositories {
  bookings: BookingWriter;
  writeAudit(entry: AuditEntry): Promise<void>;
}

export function createRepositories(db: DbClient): Repositories {
  return {
    departments: new DepartmentRepository(db),
    users: new UserRepository(db),
    refreshTokens: new RefreshTokenRepository(db),
    resources: new ResourceRepository(db),
    bookings: new BookingReader(db),
    maintenance: new MaintenanceRepository(db),
  };
}

export function createTxRepositories(tx: TxClient): TxRepositories {
  const audit = new AuditRepository(tx);
  return {
    ...createRepositories(tx),
    bookings: new BookingWriter(tx),
    writeAudit: (entry) => audit.insert(entry),
  };
}

/**
 * Interactive-transaction limits. maxWait bounds how long a request waits for
 * a pooled connection; timeout bounds the transaction itself, including time
 * spent blocked on another transaction's row or exclusion-constraint lock.
 */
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;

/**
 * The only way services reach the database. `read` uses the root client;
 * `transaction` gives one Prisma transaction per mutation, with every
 * repository (and the audit writer) bound to it.
 */
export interface UnitOfWork {
  read: Repositories;
  transaction<T>(work: (tx: TxRepositories) => Promise<T>): Promise<T>;
}

export function createUnitOfWork(prisma: PrismaClient): UnitOfWork {
  return {
    read: createRepositories(prisma),
    transaction: (work) => runInTransaction(prisma, (tx) => work(createTxRepositories(tx)), TRANSACTION_OPTIONS),
  };
}
