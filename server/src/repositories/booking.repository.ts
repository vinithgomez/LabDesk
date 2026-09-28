import { z } from "zod";
import { constraintViolationOf, Prisma, type DbClient } from "../db/prisma.js";
import type { TxClient } from "../db/transaction.js";
import {
  BOOKING_STATUSES,
  HELD_BOOKING_STATUSES,
  SLOT_HOLDING_STATUSES,
  type ApprovalInboxScope,
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
  cancelledByMaintenanceId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
const bookingRows = z.array(bookingRow);
const idRows = z.array(z.object({ id: z.string() }));

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
  b.cancelled_by_maintenance_id::text AS "cancelledByMaintenanceId",
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
  /**
   * The state a booking is born in (not a transition): 'pending' when the
   * resource requires approval, otherwise 'approved'. Every later status
   * change goes through transitionBooking.
   */
  initialStatus: "pending" | "approved";
  resourceId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  purpose: string;
  attendeeCount: number;
  idempotencyKey: string | null;
  /** Set when the booking is a materialized occurrence of a recurring series. */
  seriesId: string | null;
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

  /** Pending bookings in an approvals-inbox scope, soonest first. */
  async listPendingForInbox(scope: ApprovalInboxScope, limit: number): Promise<Booking[]> {
    const scopeSql =
      scope.kind === "department"
        ? Prisma.sql`EXISTS (SELECT 1 FROM resources r WHERE r.id = b.resource_id AND r.department_id = ${scope.departmentId}::uuid)`
        : Prisma.sql`EXISTS (SELECT 1 FROM resource_owners o WHERE o.resource_id = b.resource_id AND o.user_id = ${scope.userId}::uuid)`;
    return bookingRows.parse(
      await this.db.$queryRaw`
        SELECT ${BOOKING_COLUMNS} FROM bookings b
        WHERE b.status = 'pending' AND ${scopeSql}
        ORDER BY lower(b.period), b.id
        LIMIT ${limit}`,
    );
  }

  /** A user's bookings on one resource, in the given statuses, overlapping [from, to). */
  async listForUserOnResource(
    userId: string,
    resourceId: string,
    statuses: readonly BookingStatus[],
    from: Date,
    to: Date,
  ): Promise<Booking[]> {
    return bookingRows.parse(
      await this.db.$queryRaw`
        SELECT ${BOOKING_COLUMNS} FROM bookings b
        WHERE b.user_id = ${userId}::uuid
          AND b.resource_id = ${resourceId}::uuid
          AND b.status::text IN (${Prisma.join([...statuses])})
          AND b.period && ${range(from, to)}
        ORDER BY lower(b.period)`,
    );
  }

  // Job eligibility. Each mirrors a predicate in src/domain/checkin-rules.ts
  // (which transitionBooking re-checks under the row lock): the SQL only
  // narrows the candidates.

  /** approved, now > start + grace, never checked in. */
  async listNoShowDue(now: Date, graceMs: number, limit: number): Promise<string[]> {
    const cutoff = new Date(now.getTime() - graceMs);
    return idRows.parse(
      await this.db.$queryRaw`
        SELECT b.id::text AS id FROM bookings b
        WHERE b.status = 'approved'
          AND lower(b.period) < ${cutoff.toISOString()}::timestamptz
          AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.booking_id = b.id)
        ORDER BY lower(b.period)
        LIMIT ${limit}`,
    ).map((r) => r.id);
  }

  /** checked_in, now > end + tolerance. */
  async listAutoCompleteDue(now: Date, toleranceMs: number, limit: number): Promise<string[]> {
    const cutoff = new Date(now.getTime() - toleranceMs);
    return idRows.parse(
      await this.db.$queryRaw`
        SELECT b.id::text AS id FROM bookings b
        WHERE b.status = 'checked_in' AND upper(b.period) < ${cutoff.toISOString()}::timestamptz
        ORDER BY upper(b.period)
        LIMIT ${limit}`,
    ).map((r) => r.id);
  }

  /** pending, start has passed (it can no longer be approved). */
  async listLapsedPending(now: Date, limit: number): Promise<string[]> {
    return idRows.parse(
      await this.db.$queryRaw`
        SELECT b.id::text AS id FROM bookings b
        WHERE b.status = 'pending' AND lower(b.period) <= ${now.toISOString()}::timestamptz
        ORDER BY lower(b.period)
        LIMIT ${limit}`,
    ).map((r) => r.id);
  }

  /** Every booking materialized from a series, in time order. */
  async listBySeries(seriesId: string): Promise<Booking[]> {
    return bookingRows.parse(
      await this.db.$queryRaw`
        SELECT ${BOOKING_COLUMNS} FROM bookings b
        WHERE b.series_id = ${seriesId}::uuid
        ORDER BY lower(b.period)`,
    );
  }

  /**
   * A series' occurrences that cancelling the series cancels: not started yet,
   * and in a state the state machine lets 'cancel' leave (pending/approved).
   * transitionBooking re-checks the state under each row lock.
   */
  async listCancellableInSeries(seriesId: string, now: Date): Promise<string[]> {
    return idRows.parse(
      await this.db.$queryRaw`
        SELECT b.id::text AS id FROM bookings b
        WHERE b.series_id = ${seriesId}::uuid
          AND b.status IN ('pending', 'approved')
          AND lower(b.period) > ${now.toISOString()}::timestamptz
        ORDER BY lower(b.period)`,
    ).map((r) => r.id);
  }

  /** Whether the user has ever had a booking on the resource that held its slot. */
  async hasHeldBooking(userId: string, resourceId: string): Promise<boolean> {
    const rows = idRows.parse(
      await this.db.$queryRaw`
        SELECT b.id::text AS id FROM bookings b
        WHERE b.user_id = ${userId}::uuid AND b.resource_id = ${resourceId}::uuid
          AND b.status::text IN (${Prisma.join([...HELD_BOOKING_STATUSES])})
        LIMIT 1`,
    );
    return rows.length > 0;
  }

  /** Ids of slot-holding bookings on a resource overlapping [from, to), earliest first. */
  async listHeldOverlapping(resourceId: string, from: Date, to: Date): Promise<string[]> {
    return idRows.parse(
      await this.db.$queryRaw`
        SELECT b.id::text AS id FROM bookings b
        WHERE b.resource_id = ${resourceId}::uuid
          AND b.status::text IN (${Prisma.join([...SLOT_HOLDING_STATUSES])})
          AND b.period && ${range(from, to)}
        ORDER BY lower(b.period)`,
    ).map((r) => r.id);
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
   * Inserts a booking in its initial status (see NewBooking.initialStatus).
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
            INSERT INTO bookings (resource_id, user_id, period, status, purpose, attendee_count, idempotency_key, series_id)
            VALUES (
              ${b.resourceId}::uuid,
              ${b.userId}::uuid,
              ${range(b.startsAt, b.endsAt)},
              ${b.initialStatus}::booking_status,
              ${b.purpose},
              ${b.attendeeCount},
              ${b.idempotencyKey},
              ${b.seriesId}::uuid
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

  /**
   * The only status write in the codebase; called solely by transitionBooking.
   * `cancelledByMaintenanceId` records the window behind a maintenance cancellation.
   */
  updateStatus(id: string, status: BookingStatus, cancelledByMaintenanceId: string | null = null): Promise<Booking> {
    return translatingConstraints(async () =>
      single(
        await this.tx.$queryRaw`
          WITH updated AS (
            UPDATE bookings
            SET status = ${status}::booking_status,
                cancelled_by_maintenance_id = COALESCE(${cancelledByMaintenanceId}::uuid, cancelled_by_maintenance_id),
                updated_at = now()
            WHERE id = ${id}::uuid
            RETURNING *
          )
          SELECT ${BOOKING_COLUMNS} FROM updated b`,
      ),
    );
  }
}
