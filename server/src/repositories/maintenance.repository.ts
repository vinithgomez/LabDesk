import { z } from "zod";
import { constraintViolationOf, Prisma, type DbClient } from "../db/prisma.js";
import type { TxClient } from "../db/transaction.js";
import type { MaintenanceWindow } from "../domain/types.js";
import { ConstraintViolation } from "./constraint-violation.js";

export interface MaintenanceSlot {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

/** The exclusion constraint that keeps one resource's live windows apart. */
export const MAINTENANCE_OVERLAP_CONSTRAINT = "maintenance_windows_no_overlap";

const slotRows = z.array(z.object({ id: z.string(), startsAt: z.date(), endsAt: z.date() }));
const windowRows = z.array(
  z.object({
    id: z.string(),
    resourceId: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
    reason: z.string(),
    createdBy: z.string(),
    createdAt: z.date(),
    removedAt: z.date().nullable(),
    removedBy: z.string().nullable(),
  }),
);

const WINDOW_COLUMNS = Prisma.sql`
  m.id::text          AS "id",
  m.resource_id::text AS "resourceId",
  lower(m.period)     AS "startsAt",
  upper(m.period)     AS "endsAt",
  m.reason            AS "reason",
  m.created_by::text  AS "createdBy",
  m.created_at        AS "createdAt",
  m.removed_at        AS "removedAt",
  m.removed_by::text  AS "removedBy"`;

const range = (from: Date, to: Date): Prisma.Sql =>
  Prisma.sql`tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`;

function single(rows: unknown): MaintenanceWindow {
  const [row] = windowRows.parse(rows);
  if (!row) throw new Error("Expected exactly one maintenance window row");
  return row;
}

/**
 * Read-only maintenance queries. Raw SQL because `period` is a tstzrange.
 * Removed (soft-deleted) windows never block anything, so every read that
 * decides bookability ignores them.
 */
export class MaintenanceReader {
  constructor(protected readonly db: DbClient) {}

  /** Live windows for the resource overlapping [from, to). */
  async overlapping(resourceId: string, from: Date, to: Date): Promise<MaintenanceSlot[]> {
    return slotRows.parse(
      await this.db.$queryRaw`
        SELECT m.id::text AS "id", lower(m.period) AS "startsAt", upper(m.period) AS "endsAt"
        FROM maintenance_windows m
        WHERE m.resource_id = ${resourceId}::uuid
          AND m.removed_at IS NULL
          AND m.period && ${range(from, to)}
        ORDER BY lower(m.period)`,
    );
  }

  /** Any window, removed or not (a cancelled booking still points at it). */
  async findById(id: string): Promise<MaintenanceWindow | null> {
    const rows = windowRows.parse(
      await this.db.$queryRaw`SELECT ${WINDOW_COLUMNS} FROM maintenance_windows m WHERE m.id = ${id}::uuid`,
    );
    return rows[0] ?? null;
  }

  /** A resource's live windows ending after `from`, soonest first. */
  async listForResource(resourceId: string, from: Date, limit: number): Promise<MaintenanceWindow[]> {
    return windowRows.parse(
      await this.db.$queryRaw`
        SELECT ${WINDOW_COLUMNS} FROM maintenance_windows m
        WHERE m.resource_id = ${resourceId}::uuid
          AND m.removed_at IS NULL
          AND upper(m.period) > ${from.toISOString()}::timestamptz
        ORDER BY lower(m.period)
        LIMIT ${limit}`,
    );
  }
}

/** Maintenance writes: TxClient only, each committed with its audit row. */
export class MaintenanceWriter extends MaintenanceReader {
  constructor(private readonly tx: TxClient) {
    super(tx);
  }

  /** Overlap with another live window fails on MAINTENANCE_OVERLAP_CONSTRAINT (23P01). */
  async insert(w: { resourceId: string; startsAt: Date; endsAt: Date; reason: string; createdBy: string }): Promise<MaintenanceWindow> {
    try {
      return single(
        await this.tx.$queryRaw`
          WITH inserted AS (
            INSERT INTO maintenance_windows (resource_id, period, reason, created_by)
            VALUES (${w.resourceId}::uuid, ${range(w.startsAt, w.endsAt)}, ${w.reason}, ${w.createdBy}::uuid)
            RETURNING *
          )
          SELECT ${WINDOW_COLUMNS} FROM inserted m`,
      );
    } catch (err) {
      const violation = constraintViolationOf(err);
      if (violation) throw new ConstraintViolation(violation.sqlState, violation.constraint, violation.message);
      throw err;
    }
  }

  async lockById(id: string): Promise<void> {
    await this.tx.$executeRaw`SELECT 1 FROM maintenance_windows WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** Soft delete. */
  async markRemoved(id: string, by: string, at: Date): Promise<MaintenanceWindow> {
    return single(
      await this.tx.$queryRaw`
        WITH updated AS (
          UPDATE maintenance_windows
          SET removed_at = ${at.toISOString()}::timestamptz, removed_by = ${by}::uuid
          WHERE id = ${id}::uuid
          RETURNING *
        )
        SELECT ${WINDOW_COLUMNS} FROM updated m`,
    );
  }
}
