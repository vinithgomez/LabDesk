import { z } from "zod";
import { Prisma, type DbClient } from "../db/prisma.js";
import type { TxClient } from "../db/transaction.js";
import { SERIES_STATUSES, type BookingSeries, type SeriesSkip } from "../domain/types.js";

/**
 * Raw SQL: start_time is a Postgres `time` (Prisma maps it to a Date on
 * 1970-01-01, which invites timezone mistakes) and skip occurrences are
 * tstzranges. start_time is read back as "HH:MM".
 */
const seriesRows = z.array(
  z.object({
    id: z.string(),
    resourceId: z.string(),
    userId: z.string(),
    rrule: z.string(),
    startTime: z.string(),
    durationMinutes: z.number().int(),
    purpose: z.string(),
    attendeeCount: z.number().int(),
    status: z.enum(SERIES_STATUSES),
    materializedThrough: z.date().nullable(),
    cancelledAt: z.date().nullable(),
    createdAt: z.date(),
  }),
);
const skipRows = z.array(
  z.object({
    id: z.string(),
    seriesId: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
    reason: z.string(),
    message: z.string(),
    createdAt: z.date(),
  }),
);
const idRows = z.array(z.object({ id: z.string() }));

const SERIES_COLUMNS = Prisma.sql`
  s.id::text                          AS "id",
  s.resource_id::text                 AS "resourceId",
  s.user_id::text                     AS "userId",
  s.rrule                             AS "rrule",
  to_char(s.start_time, 'HH24:MI')    AS "startTime",
  s.duration_minutes                  AS "durationMinutes",
  s.purpose                           AS "purpose",
  s.attendee_count                    AS "attendeeCount",
  s.status::text                      AS "status",
  s.materialized_through              AS "materializedThrough",
  s.cancelled_at                      AS "cancelledAt",
  s.created_at                        AS "createdAt"`;

export interface NewSeries {
  resourceId: string;
  userId: string;
  rrule: string;
  startTime: string;
  durationMinutes: number;
  purpose: string;
  attendeeCount: number;
}

export interface NewSeriesSkip {
  seriesId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  message: string;
}

function single(rows: unknown): BookingSeries {
  const [row] = seriesRows.parse(rows);
  if (!row) throw new Error("Expected exactly one series row");
  return row;
}

/** Read-only series queries (`uow.read.series`). */
export class SeriesReader {
  constructor(protected readonly db: DbClient) {}

  async findById(id: string): Promise<BookingSeries | null> {
    const rows = seriesRows.parse(
      await this.db.$queryRaw`SELECT ${SERIES_COLUMNS} FROM booking_series s WHERE s.id = ${id}::uuid`,
    );
    return rows[0] ?? null;
  }

  /**
   * One page of active series, the nightly materializer's work list. Keyset
   * paging (id > afterId): a materialized series stays active, so a plain
   * LIMIT would hand every run the same first page.
   */
  async listActive(afterId: string | null, limit: number): Promise<string[]> {
    const after = afterId ? Prisma.sql`AND s.id > ${afterId}::uuid` : Prisma.empty;
    return idRows.parse(
      await this.db.$queryRaw`
        SELECT s.id::text AS id FROM booking_series s
        WHERE s.status = 'active' ${after}
        ORDER BY s.id
        LIMIT ${limit}`,
    ).map((r) => r.id);
  }

  async listSkips(seriesId: string): Promise<SeriesSkip[]> {
    return skipRows.parse(
      await this.db.$queryRaw`
        SELECT k.id::text AS "id", k.series_id::text AS "seriesId",
               lower(k.occurrence) AS "startsAt", upper(k.occurrence) AS "endsAt",
               k.reason AS "reason", k.message AS "message", k.created_at AS "createdAt"
        FROM booking_series_skips k
        WHERE k.series_id = ${seriesId}::uuid
        ORDER BY lower(k.occurrence)`,
    );
  }
}

/**
 * Series writes. TxClient only: the materializer's cursor and a series'
 * status are changed under `lockById`, together with their audit rows.
 */
export class SeriesWriter extends SeriesReader {
  constructor(private readonly tx: TxClient) {
    super(tx);
  }

  async insert(s: NewSeries): Promise<BookingSeries> {
    return single(
      await this.tx.$queryRaw`
        WITH inserted AS (
          INSERT INTO booking_series (resource_id, user_id, rrule, start_time, duration_minutes, purpose, attendee_count)
          VALUES (${s.resourceId}::uuid, ${s.userId}::uuid, ${s.rrule}, ${s.startTime}::time,
                  ${s.durationMinutes}, ${s.purpose}, ${s.attendeeCount})
          RETURNING *
        )
        SELECT ${SERIES_COLUMNS} FROM inserted s`,
    );
  }

  async lockById(id: string): Promise<void> {
    await this.tx.$executeRaw`SELECT 1 FROM booking_series WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** Records that every occurrence starting at or before `through` has been processed. */
  async advanceCursor(id: string, through: Date): Promise<BookingSeries> {
    return single(
      await this.tx.$queryRaw`
        WITH updated AS (
          UPDATE booking_series SET materialized_through = ${through.toISOString()}::timestamptz
          WHERE id = ${id}::uuid
          RETURNING *
        )
        SELECT ${SERIES_COLUMNS} FROM updated s`,
    );
  }

  async markCancelled(id: string, at: Date): Promise<BookingSeries> {
    return single(
      await this.tx.$queryRaw`
        WITH updated AS (
          UPDATE booking_series SET status = 'cancelled', cancelled_at = ${at.toISOString()}::timestamptz
          WHERE id = ${id}::uuid
          RETURNING *
        )
        SELECT ${SERIES_COLUMNS} FROM updated s`,
    );
  }

  async insertSkip(k: NewSeriesSkip): Promise<SeriesSkip> {
    const [row] = skipRows.parse(
      await this.tx.$queryRaw`
        WITH inserted AS (
          INSERT INTO booking_series_skips (series_id, occurrence, reason, message)
          VALUES (${k.seriesId}::uuid,
                  tstzrange(${k.startsAt.toISOString()}::timestamptz, ${k.endsAt.toISOString()}::timestamptz, '[)'),
                  ${k.reason}, ${k.message})
          RETURNING *
        )
        SELECT k.id::text AS "id", k.series_id::text AS "seriesId",
               lower(k.occurrence) AS "startsAt", upper(k.occurrence) AS "endsAt",
               k.reason AS "reason", k.message AS "message", k.created_at AS "createdAt"
        FROM inserted k`,
    );
    if (!row) throw new Error("Expected exactly one skip row");
    return row;
  }
}
