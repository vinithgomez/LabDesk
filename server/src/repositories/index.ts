import type { DbClient, PrismaClient } from "../db/prisma.js";
import type { AuditEntry } from "../domain/audit.js";
import { AuditRepository } from "./audit.repository.js";
import { BookingRepository } from "./booking.repository.js";
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
  bookings: BookingRepository;
  maintenance: MaintenanceRepository;
}

/**
 * Repositories bound to an open transaction, plus `writeAudit`. The audit
 * writer exists only here — never on `uow.read` — so an audit row can only be
 * written inside the same transaction as the mutation it records, and rolls
 * back with it.
 */
export interface TxRepositories extends Repositories {
  writeAudit(entry: AuditEntry): Promise<void>;
}

export function createRepositories(db: DbClient): Repositories {
  return {
    departments: new DepartmentRepository(db),
    users: new UserRepository(db),
    refreshTokens: new RefreshTokenRepository(db),
    resources: new ResourceRepository(db),
    bookings: new BookingRepository(db),
    maintenance: new MaintenanceRepository(db),
  };
}

export function createTxRepositories(tx: DbClient): TxRepositories {
  const audit = new AuditRepository(tx);
  return { ...createRepositories(tx), writeAudit: (entry) => audit.insert(entry) };
}

/**
 * The only way services reach the database. `read` uses the root client;
 * `transaction` gives one Prisma transaction per mutation, with every
 * repository (and the audit writer) bound to it.
 */
/**
 * Interactive-transaction limits. maxWait bounds how long a request waits for
 * a pooled connection; timeout bounds the transaction itself, including time
 * spent blocked on another transaction's row or exclusion-constraint lock.
 */
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;

export interface UnitOfWork {
  read: Repositories;
  transaction<T>(work: (tx: TxRepositories) => Promise<T>): Promise<T>;
}

export function createUnitOfWork(prisma: PrismaClient): UnitOfWork {
  return {
    read: createRepositories(prisma),
    transaction: (work) => prisma.$transaction((tx) => work(createTxRepositories(tx)), TRANSACTION_OPTIONS),
  };
}
