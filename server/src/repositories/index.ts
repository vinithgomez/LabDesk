import type { DbClient, PrismaClient } from "../db/prisma.js";
import { runInTransaction, type TxClient } from "../db/transaction.js";
import type { AuditEntry } from "../domain/audit.js";
import { AnalyticsRepository } from "./analytics.repository.js";
import { ApprovalReader, ApprovalWriter } from "./approval.repository.js";
import { AuditRepository } from "./audit.repository.js";
import { BookingReader, BookingWriter } from "./booking.repository.js";
import { CheckinReader, CheckinWriter } from "./checkin.repository.js";
import { DepartmentRepository } from "./department.repository.js";
import { MaintenanceRepository } from "./maintenance.repository.js";
import { RefreshTokenRepository } from "./refresh-token.repository.js";
import { ResourceReader, ResourceWriter } from "./resource.repository.js";
import { SeriesReader, SeriesWriter } from "./series.repository.js";
import { UserReader, UserWriter } from "./user.repository.js";
import { WaitlistReader, WaitlistWriter } from "./waitlist.repository.js";

export interface Repositories {
  departments: DepartmentRepository;
  // users, resources, bookings, approvals, checkins, waitlist and series are read-only here:
  // their writes and row locks need a transaction (see TxRepositories).
  users: UserReader;
  refreshTokens: RefreshTokenRepository;
  resources: ResourceReader;
  bookings: BookingReader;
  approvals: ApprovalReader;
  checkins: CheckinReader;
  waitlist: WaitlistReader;
  series: SeriesReader;
  maintenance: MaintenanceRepository;
  /** Read-only aggregate queries (§10). */
  analytics: AnalyticsRepository;
}

/**
 * Repositories bound to an open transaction. These capabilities exist only
 * here — never on `uow.read` — so misuse is a compile error:
 *  - `writeAudit`: an audit row is always written in the same transaction as
 *    the mutation it records, and rolls back with it.
 *  - the *Writer repositories: row locks (FOR UPDATE / FOR SHARE) and the
 *    booking advisory lock would silently do nothing outside a transaction,
 *    and audited writes must commit with their audit row.
 */
export interface TxRepositories extends Repositories {
  users: UserWriter;
  resources: ResourceWriter;
  bookings: BookingWriter;
  approvals: ApprovalWriter;
  checkins: CheckinWriter;
  waitlist: WaitlistWriter;
  series: SeriesWriter;
  writeAudit(entry: AuditEntry): Promise<void>;
}

export function createRepositories(db: DbClient): Repositories {
  return {
    departments: new DepartmentRepository(db),
    users: new UserReader(db),
    refreshTokens: new RefreshTokenRepository(db),
    resources: new ResourceReader(db),
    bookings: new BookingReader(db),
    approvals: new ApprovalReader(db),
    checkins: new CheckinReader(db),
    waitlist: new WaitlistReader(db),
    series: new SeriesReader(db),
    maintenance: new MaintenanceRepository(db),
    analytics: new AnalyticsRepository(db),
  };
}

export function createTxRepositories(tx: TxClient): TxRepositories {
  const audit = new AuditRepository(tx);
  return {
    ...createRepositories(tx),
    users: new UserWriter(tx),
    resources: new ResourceWriter(tx),
    bookings: new BookingWriter(tx),
    approvals: new ApprovalWriter(tx),
    checkins: new CheckinWriter(tx),
    waitlist: new WaitlistWriter(tx),
    series: new SeriesWriter(tx),
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
