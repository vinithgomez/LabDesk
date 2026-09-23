import { z } from "zod";
import { constraintViolationOf, Prisma, type DbClient } from "../db/prisma.js";
import { BOOKING_STATUSES, type Booking } from "../domain/types.js";
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

/** Advisory-lock namespace (first key) for per-resource booking inserts ("LD"). */
const BOOKING_INSERT_LOCK_NAMESPACE = 0x4c44;

export interface NewBooking {
  resourceId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  purpose: string;
  attendeeCount: number;
  idempotencyKey: string | null;
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

export class BookingRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * Inserts a booking. New bookings always start as 'pending' (CLAUDE.md §5).
   * Must run inside a transaction.
   *
   * Overlap is rejected by the `bookings_no_overlap` exclusion constraint,
   * never by a pre-check. Before inserting we take a transaction-scoped
   * advisory lock on the resource. It checks nothing; it only orders
   * concurrent inserts for one resource. Without it, simultaneous inserters
   * each find the other's uncommitted row, wait on each other, and deadlock
   * (40P01) — Postgres then breaks one cycle per deadlock_timeout, so a burst
   * on a popular slot turns into 500s and multi-second stalls. With it, each
   * later inserter sees the committed winner and fails fast with 23P01.
   */
  insert(b: NewBooking): Promise<Booking> {
    return translatingConstraints(async () => {
      await this.db.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_INSERT_LOCK_NAMESPACE}::int, hashtext(${b.resourceId}))`;
      return single(
        await this.db.$queryRaw`
          WITH inserted AS (
            INSERT INTO bookings (resource_id, user_id, period, status, purpose, attendee_count, idempotency_key)
            VALUES (
              ${b.resourceId}::uuid,
              ${b.userId}::uuid,
              tstzrange(${b.startsAt.toISOString()}::timestamptz, ${b.endsAt.toISOString()}::timestamptz, '[)'),
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

  async findById(id: string): Promise<Booking | null> {
    const rows = bookingRows.parse(
      await this.db.$queryRaw`SELECT ${BOOKING_COLUMNS} FROM bookings b WHERE b.id = ${id}::uuid`,
    );
    return rows[0] ?? null;
  }
}
