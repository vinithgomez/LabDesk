import { z } from "zod";
import type { DbClient } from "../db/prisma.js";

export interface MaintenanceSlot {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

const maintenanceRows = z.array(z.object({ id: z.string(), startsAt: z.date(), endsAt: z.date() }));

/**
 * Read-only in Phase 2 (window management is Phase 7). Raw SQL because
 * `period` is a tstzrange.
 */
export class MaintenanceRepository {
  constructor(private readonly db: DbClient) {}

  /** Windows for the resource overlapping [from, to). */
  async overlapping(resourceId: string, from: Date, to: Date): Promise<MaintenanceSlot[]> {
    return maintenanceRows.parse(
      await this.db.$queryRaw`
        SELECT m.id::text AS "id", lower(m.period) AS "startsAt", upper(m.period) AS "endsAt"
        FROM maintenance_windows m
        WHERE m.resource_id = ${resourceId}::uuid
          AND m.period && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')
        ORDER BY lower(m.period)`,
    );
  }
}
