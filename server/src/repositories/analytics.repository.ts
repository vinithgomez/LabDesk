import { z } from "zod";
import { Prisma, type DbClient } from "../db/prisma.js";

/**
 * Analytics queries (CLAUDE.md §10). Every aggregate is computed by
 * PostgreSQL: these are parameterized SQL query functions, and the only
 * TypeScript here builds and validates them. Periods are clipped to the
 * window with the range intersection operator (`*`), so a booking or session
 * that straddles a window edge counts only for the part inside it.
 *
 * Two SQL functions from the business-hours migration are used:
 *  - range_minutes(tstzrange): length in minutes, 0 when empty;
 *  - business_intervals(start, end, days, from, to): a resource's open hours
 *    within [from, to) as UTC ranges (IST wall-clock, per business day).
 */

/** Which resources a query covers. `departmentId` null = every department. */
export interface AnalyticsScope {
  departmentId: string | null;
  resourceId: string | null;
}

export interface AnalyticsWindow {
  from: Date;
  to: Date;
}

/** Statuses whose booked time counts: everything but cancelled and rejected (which includes expired). */
const NOT_BOOKED = Prisma.sql`('cancelled', 'rejected')`;

/**
 * Attendance outcomes: the only statuses in a no-show rate's denominator.
 * Rejected and expired (and cancelled, pending, approved) are not outcomes
 * of turning up, so they never affect the rate.
 */
const ATTENDANCE_OUTCOMES = Prisma.sql`('no_show', 'completed', 'checked_in')`;

const tstz = (d: Date): Prisma.Sql => Prisma.sql`${d.toISOString()}::timestamptz`;
const windowRange = (w: AnalyticsWindow): Prisma.Sql => Prisma.sql`tstzrange(${tstz(w.from)}, ${tstz(w.to)}, '[)')`;

/** Total minutes covered by a tstzmultirange (0 when NULL or empty). */
const multirangeMinutes = (m: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`(SELECT COALESCE(SUM(range_minutes(part)), 0) FROM unnest(${m}) AS part)`;

function scopeFilter(scope: AnalyticsScope, alias: Prisma.Sql): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (scope.departmentId !== null) parts.push(Prisma.sql`${alias}.department_id = ${scope.departmentId}::uuid`);
  if (scope.resourceId !== null) parts.push(Prisma.sql`${alias}.id = ${scope.resourceId}::uuid`);
  return parts.length > 0 ? Prisma.join(parts, " AND ") : Prisma.sql`TRUE`;
}

const utilizationRow = z.object({
  resourceId: z.string(),
  name: z.string(),
  departmentId: z.string(),
  isActive: z.boolean(),
  createdAt: z.date(),
  availableMinutes: z.number(),
  bookedMinutes: z.number(),
  /** All checked-in time in the window: inHoursMinutes + offHoursMinutes. */
  actualMinutes: z.number(),
  /** Checked-in time within business hours on business days — the utilization numerator. */
  inHoursMinutes: z.number(),
  /** Checked-in time outside business hours or on a non-business day; reported, never in the ratio. */
  offHoursMinutes: z.number(),
  autoCompletedMinutes: z.number(),
  bookings: z.number().int(),
  sessions: z.number().int(),
  /** inHours / available, so never above 1; null when the resource has no open hours in the window. */
  utilization: z.number().nullable(),
});
export type UtilizationRow = z.infer<typeof utilizationRow>;

const utilizationTotals = utilizationRow.pick({
  availableMinutes: true,
  bookedMinutes: true,
  actualMinutes: true,
  inHoursMinutes: true,
  offHoursMinutes: true,
  autoCompletedMinutes: true,
  bookings: true,
  sessions: true,
  utilization: true,
});
export type UtilizationTotals = z.infer<typeof utilizationTotals>;

const outcomeCounts = z.object({
  noShows: z.number().int(),
  attended: z.number().int(),
  outcomes: z.number().int(),
  /** noShows / outcomes; null when there were no outcomes. */
  rate: z.number().nullable(),
});
export type OutcomeCounts = z.infer<typeof outcomeCounts>;

const noShowByUser = outcomeCounts.extend({ userId: z.string(), fullName: z.string(), rollNo: z.string().nullable() });
const noShowByResource = outcomeCounts.extend({ resourceId: z.string(), name: z.string() });
export type NoShowByUser = z.infer<typeof noShowByUser>;
export type NoShowByResource = z.infer<typeof noShowByResource>;

const heatmapCell = z.object({
  /** EXTRACT(dow), IST: 0 = Sunday. */
  dow: z.number().int(),
  /** Hour of day, IST. */
  hour: z.number().int(),
  bookedMinutes: z.number(),
  /** Bookings occupying some part of this hour, summed over the window. */
  bookings: z.number().int(),
});
export type HeatmapCell = z.infer<typeof heatmapCell>;

const idleRow = utilizationRow.extend({
  observedDays: z.number(),
  excludedReason: z.enum(["INACTIVE", "INSUFFICIENT_DATA", "NO_AVAILABLE_HOURS"]).nullable(),
});
export type IdleRow = z.infer<typeof idleRow>;

export class AnalyticsRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * Per resource in scope:
   *  - available: its business hours on its business days within the
   *    window, from its creation on;
   *  - booked: bookings other than cancelled/rejected;
   *  - actual: checked-in sessions that have ended (auto-completed ones
   *    included, and also reported separately), split into in-hours and
   *    off-hours time;
   *  - utilization = in-hours / available.
   *
   * Sessions and open hours are each merged into one multirange before
   * measuring, so overlapping sessions (a late check-out meeting the next
   * booking's early check-in) never count twice, and in-hours time — the
   * intersection with the open hours — can never exceed the open hours
   * themselves: utilization is at most 1 by construction.
   */
  private perResourceUtilization(scope: AnalyticsScope, w: AnalyticsWindow): Prisma.Sql {
    const win = windowRange(w);
    return Prisma.sql`
      WITH scoped AS (
        SELECT r.id, r.name, r.department_id, r.is_active, r.created_at,
               r.business_hours_start, r.business_hours_end, r.business_days
        FROM resources r
        WHERE ${scopeFilter(scope, Prisma.sql`r`)}
      ),
      -- Open hours (business hours on business days) as one multirange,
      -- counted from when the resource came into service: time before it
      -- existed is not available-but-unused.
      open_hours AS (
        SELECT s.id, range_agg(bi.slot) AS hours
        FROM scoped s
        CROSS JOIN LATERAL business_intervals(
          s.business_hours_start, s.business_hours_end, s.business_days,
          LEAST(GREATEST(${tstz(w.from)}, s.created_at), ${tstz(w.to)}), ${tstz(w.to)}) bi
        GROUP BY s.id
      ),
      booked AS (
        SELECT bk.resource_id AS id, SUM(range_minutes(bk.period * ${win})) AS minutes, COUNT(*) AS bookings
        FROM bookings bk JOIN scoped s ON s.id = bk.resource_id
        WHERE bk.period && ${win} AND bk.status NOT IN ${NOT_BOOKED}
        GROUP BY bk.resource_id
      ),
      -- Ended sessions, clipped to the window and merged per resource.
      sessions AS (
        SELECT bk.resource_id AS id,
               range_agg(tstzrange(c.checked_in_at, c.checked_out_at, '[)') * ${win}) AS used,
               range_agg(tstzrange(c.checked_in_at, c.checked_out_at, '[)') * ${win})
                 FILTER (WHERE c.checkout_method = 'auto') AS auto_used,
               COUNT(*) AS sessions
        FROM checkins c
        JOIN bookings bk ON bk.id = c.booking_id
        JOIN scoped s ON s.id = bk.resource_id
        WHERE c.checked_out_at IS NOT NULL
          AND tstzrange(c.checked_in_at, c.checked_out_at, '[)') && ${win}
        GROUP BY bk.resource_id
      ),
      actual AS (
        SELECT x.id,
               ${multirangeMinutes(Prisma.sql`x.used`)} AS minutes,
               ${multirangeMinutes(Prisma.sql`x.used * COALESCE(o.hours, '{}'::tstzmultirange)`)} AS in_hours,
               ${multirangeMinutes(Prisma.sql`x.used - COALESCE(o.hours, '{}'::tstzmultirange)`)} AS off_hours,
               ${multirangeMinutes(Prisma.sql`x.auto_used`)} AS auto_minutes,
               x.sessions
        FROM sessions x
        LEFT JOIN open_hours o ON o.id = x.id
      ),
      available AS (
        SELECT o.id, ${multirangeMinutes(Prisma.sql`o.hours`)} AS minutes FROM open_hours o
      )
      SELECT s.id::text                          AS "resourceId",
             s.name                              AS "name",
             s.department_id::text               AS "departmentId",
             s.is_active                         AS "isActive",
             s.created_at                        AS "createdAt",
             COALESCE(a.minutes, 0)::float8      AS "availableMinutes",
             COALESCE(b.minutes, 0)::float8      AS "bookedMinutes",
             COALESCE(x.minutes, 0)::float8      AS "actualMinutes",
             COALESCE(x.in_hours, 0)::float8     AS "inHoursMinutes",
             COALESCE(x.off_hours, 0)::float8    AS "offHoursMinutes",
             COALESCE(x.auto_minutes, 0)::float8 AS "autoCompletedMinutes",
             COALESCE(b.bookings, 0)::int        AS "bookings",
             COALESCE(x.sessions, 0)::int        AS "sessions",
             (CASE WHEN COALESCE(a.minutes, 0) > 0 THEN COALESCE(x.in_hours, 0) / a.minutes END)::float8 AS "utilization"
      FROM scoped s
      LEFT JOIN available a ON a.id = s.id
      LEFT JOIN booked b ON b.id = s.id
      LEFT JOIN actual x ON x.id = s.id`;
  }

  async utilization(scope: AnalyticsScope, w: AnalyticsWindow): Promise<UtilizationRow[]> {
    return z.array(utilizationRow).parse(
      await this.db.$queryRaw`
        SELECT * FROM (${this.perResourceUtilization(scope, w)}) t
        ORDER BY t."utilization" DESC NULLS LAST, t."name", t."resourceId"`,
    );
  }

  /** The same measures summed over the scope; utilization = total in-hours / total available. */
  async utilizationTotals(scope: AnalyticsScope, w: AnalyticsWindow): Promise<UtilizationTotals> {
    const [row] = z.array(utilizationTotals).parse(
      await this.db.$queryRaw`
        SELECT COALESCE(SUM(t."availableMinutes"), 0)::float8     AS "availableMinutes",
               COALESCE(SUM(t."bookedMinutes"), 0)::float8        AS "bookedMinutes",
               COALESCE(SUM(t."actualMinutes"), 0)::float8        AS "actualMinutes",
               COALESCE(SUM(t."inHoursMinutes"), 0)::float8       AS "inHoursMinutes",
               COALESCE(SUM(t."offHoursMinutes"), 0)::float8      AS "offHoursMinutes",
               COALESCE(SUM(t."autoCompletedMinutes"), 0)::float8 AS "autoCompletedMinutes",
               COALESCE(SUM(t."bookings"), 0)::int                AS "bookings",
               COALESCE(SUM(t."sessions"), 0)::int                AS "sessions",
               (CASE WHEN SUM(t."availableMinutes") > 0
                     THEN SUM(t."inHoursMinutes") / SUM(t."availableMinutes") END)::float8 AS "utilization"
        FROM (${this.perResourceUtilization(scope, w)}) t`,
    );
    if (!row) throw new Error("utilization totals returned no row");
    return row;
  }

  /**
   * Attendance outcomes of bookings that started in the window, on resources
   * in scope. no-show rate = no_show / (no_show + completed + checked_in).
   */
  private outcomes(scope: AnalyticsScope, w: AnalyticsWindow): Prisma.Sql {
    return Prisma.sql`
      WITH outcomes AS (
        SELECT bk.user_id, bk.resource_id, bk.status
        FROM bookings bk JOIN resources r ON r.id = bk.resource_id
        WHERE ${scopeFilter(scope, Prisma.sql`r`)}
          AND lower(bk.period) >= ${tstz(w.from)} AND lower(bk.period) < ${tstz(w.to)}
          AND bk.status IN ${ATTENDANCE_OUTCOMES}
      )`;
  }

  async noShowOverall(scope: AnalyticsScope, w: AnalyticsWindow): Promise<OutcomeCounts> {
    const [row] = z.array(outcomeCounts).parse(
      await this.db.$queryRaw`
        ${this.outcomes(scope, w)}
        SELECT ${OUTCOME_COLUMNS} FROM outcomes o`,
    );
    if (!row) throw new Error("no-show overall returned no row");
    return row;
  }

  async noShowsByUser(scope: AnalyticsScope, w: AnalyticsWindow): Promise<NoShowByUser[]> {
    return z.array(noShowByUser).parse(
      await this.db.$queryRaw`
        ${this.outcomes(scope, w)}
        SELECT o.user_id::text AS "userId", u.full_name AS "fullName", u.roll_no AS "rollNo", ${OUTCOME_COLUMNS}
        FROM outcomes o JOIN users u ON u.id = o.user_id
        GROUP BY o.user_id, u.full_name, u.roll_no
        ORDER BY "rate" DESC, "noShows" DESC, u.full_name, o.user_id`,
    );
  }

  async noShowsByResource(scope: AnalyticsScope, w: AnalyticsWindow): Promise<NoShowByResource[]> {
    return z.array(noShowByResource).parse(
      await this.db.$queryRaw`
        ${this.outcomes(scope, w)}
        SELECT o.resource_id::text AS "resourceId", r.name AS "name", ${OUTCOME_COLUMNS}
        FROM outcomes o JOIN resources r ON r.id = o.resource_id
        GROUP BY o.resource_id, r.name
        ORDER BY "rate" DESC, "noShows" DESC, r.name, o.resource_id`,
    );
  }

  /**
   * Booked minutes per IST (day-of-week, hour) cell, over bookings other than
   * cancelled/rejected. A booking is split across every hour it touches.
   * generate_series supplies all 7 x 24 cells, so an empty cell is a 0 row,
   * never a missing one. Bucketing is done on IST wall-clock timestamps:
   * IST is UTC+05:30, so UTC hours would split every IST hour in two.
   */
  async heatmap(scope: AnalyticsScope, w: AnalyticsWindow): Promise<HeatmapCell[]> {
    const win = windowRange(w);
    return z.array(heatmapCell).parse(
      await this.db.$queryRaw`
        WITH local AS (
          SELECT lower(bk.period * ${win}) AT TIME ZONE 'Asia/Kolkata' AS s,
                 upper(bk.period * ${win}) AT TIME ZONE 'Asia/Kolkata' AS e
          FROM bookings bk JOIN resources r ON r.id = bk.resource_id
          WHERE ${scopeFilter(scope, Prisma.sql`r`)}
            AND bk.period && ${win} AND bk.status NOT IN ${NOT_BOOKED}
        ),
        cells AS (
          SELECT EXTRACT(dow FROM h)::int AS dow,
                 EXTRACT(hour FROM h)::int AS hour,
                 SUM(EXTRACT(EPOCH FROM LEAST(l.e, h + interval '1 hour') - GREATEST(l.s, h)) / 60) AS minutes,
                 COUNT(*) AS bookings
          FROM local l
          CROSS JOIN LATERAL generate_series(date_trunc('hour', l.s), l.e - interval '1 microsecond', interval '1 hour') AS h
          GROUP BY 1, 2
        )
        SELECT d.dow::int AS "dow", hr.hour::int AS "hour",
               COALESCE(c.minutes, 0)::float8 AS "bookedMinutes",
               COALESCE(c.bookings, 0)::int AS "bookings"
        FROM generate_series(0, 6) AS d(dow)
        CROSS JOIN generate_series(0, 23) AS hr(hour)
        LEFT JOIN cells c ON c.dow = d.dow AND c.hour = hr.hour
        ORDER BY d.dow, hr.hour`,
    );
  }

  /**
   * Utilization per resource plus eligibility for the idle ranking. A
   * resource is observed from max(window start, its creation) to the window
   * end; fewer than `minimumDays` of that is INSUFFICIENT_DATA. Inactive
   * resources and ones with no open hours are excluded too, with a reason.
   */
  async idleCandidates(scope: AnalyticsScope, w: AnalyticsWindow, minimumDays: number): Promise<IdleRow[]> {
    return z.array(idleRow).parse(
      await this.db.$queryRaw`
        SELECT t.*, o.days::float8 AS "observedDays",
               CASE
                 WHEN NOT t."isActive" THEN 'INACTIVE'
                 WHEN o.days < ${minimumDays} THEN 'INSUFFICIENT_DATA'
                 WHEN t."availableMinutes" = 0 THEN 'NO_AVAILABLE_HOURS'
               END AS "excludedReason"
        FROM (${this.perResourceUtilization(scope, w)}) t
        CROSS JOIN LATERAL (
          SELECT GREATEST(EXTRACT(EPOCH FROM ${tstz(w.to)} - GREATEST(${tstz(w.from)}, t."createdAt")), 0) / 86400 AS days
        ) o
        ORDER BY t."utilization" ASC NULLS LAST, t."bookedMinutes" ASC, t."name", t."resourceId"`,
    );
  }
}

const OUTCOME_COLUMNS = Prisma.sql`
  COUNT(*) FILTER (WHERE o.status = 'no_show')::int                    AS "noShows",
  COUNT(*) FILTER (WHERE o.status IN ('completed', 'checked_in'))::int AS "attended",
  COUNT(*)::int                                                        AS "outcomes",
  (COUNT(*) FILTER (WHERE o.status = 'no_show'))::float8 / NULLIF(COUNT(*), 0) AS "rate"`;
