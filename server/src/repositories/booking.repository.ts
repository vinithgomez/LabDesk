import { z } from "zod";
import { constraintViolationOf, Prisma, type DbClient } from "../db/prisma.js";
import type { TxClient } from "../db/transaction.js";
import {
  BOOKING_STATUSES,
  SLOT_HOLDING_STATUSES,
  type Booking,
  type BookingListScope,
  type BookingStatus,
} from "../domain/types.js";
import { ConstraintViolation } from "./constraint-violation.js";

/**
 * Bookings are queried with raw SQL because `period` is a tstzrange, which
 * Prisma cannot model. Every row is validated on the way out rather than
 * cast, and ranges are always built as half-open '[)' in UTC.
 */
const bookingRow = z.object({
  id: z.string(),
  resourceId: z.string(),
  userId: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  status: z.enum(BOOKING_STATUSES),
  purpose: z.string(),
  attendeeCount: z.number().int(),
  seriesId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
const bookingRows = z.array(bookingRow);

const BOOKING_COLUMNS = Prisma.sql`
  b.id::text              AS "id",
  b.resource_id::text     AS "resourceId",
  b.user_id::text         AS "userId",
  lower(b.period)         AS "startsAt",
  upper(b.period)         AS "endsAt",
  b.status::text          AS "status",
  b.purpose               AS "purpose",
  b.attendee_count        AS "attendeeCount",
  b.series_id::text       AS "seriesId",
  b.created_at            AS "createdAt",
  b.updated_at            AS "updatedAt"`;

/**
 * Advisory-lock namespace for booking inserts: "LD" (CLAUDE.md §2c). The
 * two-argument pg_advisory_xact_lock(int4, int4) form keeps this key space
 * separate from any other advisory lock; both keys must be int4, which is why
 * the resource key is hashtext (int4), not hashtextextended (bigint).
 */
const BOOKING_INSERT_LOCK_NAMESPACE = 0x4c44; // 19524

/** The unique partial index behind per-user idempotency keys (CLAUDE.md §4). */
export const IDEMPOTENCY_INDEX = "bookings_user_idempotency_key";

const range = (from: Date, to: Date): Prisma.Sql =>
  Prisma.sql`tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`;

export interface NewBooking {
  resourceId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  purpose: string;
  attendeeCount: number;
  idempotencyKey: string | null;
}

export interface BookingListFilter {
  statuses?: readonly BookingStatus[] | undefined;
  resourceId?: string | undefined;
  /** Bookings whose period overlaps [from, to). Either bound may be open. */
  from?: Date | undefined;
  to?: Date | undefined;
  limit: number;
}

export interface HeldSlot {
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
}

/** Runs a write, translating constraint failures into ConstraintViolation. */
async function translatingConstraints<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    const violation = constraintViolationOf(err);
    if (violation) throw new ConstraintViolation(violation.sqlState, violation.constraint, violation.message);
    throw err;
  }
}

function single(rows: unknown): Booking {
  const [row] = bookingRows.parse(rows);
  if (!row) throw new Error("Expected exactly one booking row");
  return row;
}

/**
 * Read-only booking queries. Safe on any client, so this is what
 * `uow.read.bookings` exposes.
 */
export class BookingReader {
  constructor(protected readonly db: DbClient) {}

  async findById(id: string): Promise<Booking | null> {
    const rows = bookingRows.parse(
      await this.db.$queryRaw`SELECT ${BOOKING_COLUMNS} FROM bookings b WHERE b.id = ${id}::uuid`,
    );
    return rows[0] ?? null;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<Booking | null> {
    const rows = bookingRows.parse(
      await this.db.$queryRaw`
        SELECT ${BOOKING_COLUMNS} FROM bookings b
        WHERE b.user_id = ${userId}::uuid AND b.idempotency_key = ${key}`,
    );
    return rows[0] ?? null;
  }

  async list(scope: BookingListScope, filter: BookingListFilter): Promise<Booking[]> {
    const where: Prisma.Sql[] = [];
    if (scope.kind === "own") where.push(Prisma.sql`b.user_id = ${scope.userId}::uuid`);
    if (scope.kind === "ownOrManaged") {
      where.push(Prisma.sql`(
        b.user_id = ${scope.userId}::uuid
        OR EXISTS (SELECT 1 FROM resource_owners o WHERE o.resource_id = b.resource_id AND o.user_id = ${scope.userId}::uuid)
      )`);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      where.push(Prisma.sql`b.status::text IN (${Prisma.join([...filter.statuses])})`);
    }
    if (filter.resourceId) where.push(Prisma.sql`b.resource_id = ${filter.resourceId}::uuid`);
    if (filter.from || filter.to) {
      where.push(Prisma.sql`b.period && tstzrange(
        ${filter.from?.toISOString() ?? null}::timestamptz,
        ${filter.to?.toISOString() ?? null}::timestamptz, '[)')`);
    }
    const whereSql = where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty;

    return bookingRows.parse(
      await this.db.$queryRaw`
        SELECT ${BOOKING_COLUMNS} FROM bookings b
        ${whereSql}
        ORDER BY lower(b.period), b.id
        LIMIT ${filter.limit}`,
    );
  }

  /** Slot-holding bookings (pending/approved/checked_in) overlapping [from, to). */
  async heldSlots(resourceId: string, from: Date, to: Date): Promise<HeldSlot[]> {
    return z
      .array(z.object({ startsAt: z.date(), endsAt: z.date(), status: z.enum(BOOKING_STATUSES) }))
      .parse(
        await this.db.$queryRaw`
          SELECT lower(b.period) AS "startsAt", upper(b.period) AS "endsAt", b.status::text AS "status"
          FROM bookings b
          WHERE b.resource_id = ${resourceId}::uuid
            AND b.status::text IN (${Prisma.join([...SLOT_HOLDING_STATUSES])})
            AND b.period && ${range(from, to)}
          ORDER BY lower(b.period)`,
      );
  }
}

/**
 * Booking writes. Every method here depends on transaction scope (an
 * xact-scoped advisory lock, FOR UPDATE, or a status change that must commit
 * with its audit row), so the constructor accepts only a TxClient: building
 * one from the root client is a compile error, and `uow.read.bookings` is a
 * BookingReader with no write methods at all.
 */
export class BookingWriter extends BookingReader {
  constructor(private readonly tx: TxClient) {
    super(tx);
  }

  /**
   * Inserts a booking. New bookings always start as 'pending' (CLAUDE.md §5).
   *
   * Overlap is rejected by the `bookings_no_overlap` exclusion constraint,
   * never by a pre-check. Before inserting we take a transaction-scoped
   * advisory lock on the resource (CLAUDE.md §2c). It checks nothing; it only
   * orders concurrent inserts for one resource. Without it, simultaneous
   * inserters each find the other's uncommitted row, wait on each other, and
   * deadlock (40P01) — Postgres then breaks one cycle per deadlock_timeout, so
   * a burst on a popular slot turns into 500s and multi-second stalls. With
   * it, each later inserter sees the committed winner and fails fast with
   * 23P01. Outside a transaction the lock would be released as soon as the
   * SELECT finished, which is why this class requires a TxClient.
   */
  insert(b: NewBooking): Promise<Booking> {
    return translatingConstraints(async () => {
      // hashtext collisions are harmless: two resources sharing a key only serialize briefly, never a correctness issue.
      await this.tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_INSERT_LOCK_NAMESPACE}::int4, hashtext(${b.resourceId}::text))`;
      return single(
        await this.tx.$queryRaw`
          WITH inserted AS (
            INSERT INTO bookings (resource_id, user_id, period, status, purpose, attendee_count, idempotency_key)
            VALUES (
              ${b.resourceId}::uuid,
              ${b.userId}::uuid,
              ${range(b.startsAt, b.endsAt)},
              'pending',
              ${b.purpose},
              ${b.attendeeCount},
              ${b.idempotencyKey}
            )
            RETURNING *
          )
          SELECT ${BOOKING_COLUMNS} FROM inserted b`,
      );
    });
  }

  /** Row-locks a booking for the rest of the transaction (before audit snapshots). */
  async lockById(id: string): Promise<void> {
    await this.tx.$executeRaw`SELECT 1 FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** The only status write in the codebase; called solely by transitionBooking. */
  updateStatus(id: string, status: BookingStatus): Promise<Booking> {
    return translatingConstraints(async () =>
      single(
        await this.tx.$queryRaw`
          WITH updated AS (
            UPDATE bookings SET status = ${status}::booking_status, updated_at = now()
            WHERE id = ${id}::uuid
            RETURNING *
          )
          SELECT ${BOOKING_COLUMNS} FROM updated b`,
      ),
    );
  }
}
