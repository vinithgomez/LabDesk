import { z } from "zod";
import { constraintViolationOf, Prisma, type DbClient } from "../db/prisma.js";
import type { TxClient } from "../db/transaction.js";
import { SLOT_HOLDING_STATUSES, WAITLIST_STATUSES, type WaitlistEntry, type WaitlistStatus } from "../domain/types.js";
import { ConstraintViolation } from "./constraint-violation.js";

/**
 * Waitlist entries are queried with raw SQL because `desired_period` is a
 * tstzrange. Rows are validated on the way out, as for bookings.
 */
const entryRows = z.array(
  z.object({
    id: z.string(),
    resourceId: z.string(),
    userId: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
    purpose: z.string(),
    attendeeCount: z.number().int(),
    status: z.enum(WAITLIST_STATUSES),
    bookingId: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
);
const idRows = z.array(z.object({ id: z.string() }));

const ENTRY_COLUMNS = Prisma.sql`
  w.id::text           AS "id",
  w.resource_id::text  AS "resourceId",
  w.user_id::text      AS "userId",
  lower(w.desired_period) AS "startsAt",
  upper(w.desired_period) AS "endsAt",
  w.purpose            AS "purpose",
  w.attendee_count     AS "attendeeCount",
  w.status::text       AS "status",
  w.booking_id::text   AS "bookingId",
  w.created_at         AS "createdAt",
  w.updated_at         AS "updatedAt"`;

/** The exclusion constraint allowing one waiting entry per user per overlapping period. */
export const WAITLIST_DUPLICATE_CONSTRAINT = "waitlist_entries_no_duplicate";

export interface NewWaitlistEntry {
  resourceId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  purpose: string;
  attendeeCount: number;
}

const range = (from: Date, to: Date): Prisma.Sql =>
  Prisma.sql`tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`;

function single(rows: unknown): WaitlistEntry {
  const [row] = entryRows.parse(rows);
  if (!row) throw new Error("Expected exactly one waitlist row");
  return row;
}

/** Read-only waitlist queries (`uow.read.waitlist`). */
export class WaitlistReader {
  constructor(protected readonly db: DbClient) {}

  async findById(id: string): Promise<WaitlistEntry | null> {
    const rows = entryRows.parse(
      await this.db.$queryRaw`SELECT ${ENTRY_COLUMNS} FROM waitlist_entries w WHERE w.id = ${id}::uuid`,
    );
    return rows[0] ?? null;
  }

  /** A user's own entries, newest first. */
  async listForUser(userId: string, statuses: readonly WaitlistStatus[] | undefined, limit: number): Promise<WaitlistEntry[]> {
    const statusSql =
      statuses && statuses.length > 0
        ? Prisma.sql`AND w.status::text IN (${Prisma.join([...statuses])})`
        : Prisma.empty;
    return entryRows.parse(
      await this.db.$queryRaw`
        SELECT ${ENTRY_COLUMNS} FROM waitlist_entries w
        WHERE w.user_id = ${userId}::uuid ${statusSql}
        ORDER BY w.created_at DESC, w.id
        LIMIT ${limit}`,
    );
  }

  /**
   * The promoter's queue: waiting entries not yet started whose desired
   * period is, right now, clear of every slot-holding booking and maintenance
   * window on an active resource — oldest first (FIFO by created_at).
   *
   * This only narrows the candidates. Two entries in this list may overlap
   * each other; promotion inserts through the normal booking path, so the
   * exclusion constraint lets the older one win and rejects the other.
   */
  async listPromotable(now: Date, limit: number): Promise<string[]> {
    return idRows.parse(
      await this.db.$queryRaw`
        SELECT w.id::text AS id FROM waitlist_entries w
        JOIN resources r ON r.id = w.resource_id AND r.is_active
        WHERE w.status = 'waiting'
          AND lower(w.desired_period) > ${now.toISOString()}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.resource_id = w.resource_id
              AND b.status::text IN (${Prisma.join([...SLOT_HOLDING_STATUSES])})
              AND b.period && w.desired_period)
          AND NOT EXISTS (
            SELECT 1 FROM maintenance_windows m
            WHERE m.resource_id = w.resource_id AND m.period && w.desired_period)
        ORDER BY w.created_at, w.id
        LIMIT ${limit}`,
    ).map((r) => r.id);
  }

  /** Waiting entries whose desired start has arrived: they can no longer be promoted. */
  async listExpiryDue(now: Date, limit: number): Promise<string[]> {
    return idRows.parse(
      await this.db.$queryRaw`
        SELECT w.id::text AS id FROM waitlist_entries w
        WHERE w.status = 'waiting' AND lower(w.desired_period) <= ${now.toISOString()}::timestamptz
        ORDER BY lower(w.desired_period), w.id
        LIMIT ${limit}`,
    ).map((r) => r.id);
  }
}

/**
 * Waitlist writes. TxClient only: every write commits with its audit row, and
 * status changes happen under `lockById`.
 */
export class WaitlistWriter extends WaitlistReader {
  constructor(private readonly tx: TxClient) {
    super(tx);
  }

  async insert(e: NewWaitlistEntry): Promise<WaitlistEntry> {
    try {
      return single(
        await this.tx.$queryRaw`
          WITH inserted AS (
            INSERT INTO waitlist_entries (resource_id, user_id, desired_period, purpose, attendee_count)
            VALUES (${e.resourceId}::uuid, ${e.userId}::uuid, ${range(e.startsAt, e.endsAt)}, ${e.purpose}, ${e.attendeeCount})
            RETURNING *
          )
          SELECT ${ENTRY_COLUMNS} FROM inserted w`,
      );
    } catch (err) {
      const violation = constraintViolationOf(err);
      if (violation) throw new ConstraintViolation(violation.sqlState, violation.constraint, violation.message);
      throw err;
    }
  }

  async lockById(id: string): Promise<void> {
    await this.tx.$executeRaw`SELECT 1 FROM waitlist_entries WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** The only status write for entries; called solely by WaitlistService. */
  async updateStatus(id: string, status: WaitlistStatus, bookingId: string | null = null): Promise<WaitlistEntry> {
    return single(
      await this.tx.$queryRaw`
        WITH updated AS (
          UPDATE waitlist_entries
          SET status = ${status}::waitlist_status, booking_id = ${bookingId}::uuid, updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING *
        )
        SELECT ${ENTRY_COLUMNS} FROM updated w`,
    );
  }
}
