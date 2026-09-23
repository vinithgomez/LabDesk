import { Prisma, type DbClient } from "../db/prisma.js";
import { toAuditSnapshot, type AuditEntry, type JsonObject } from "../domain/audit.js";

export class AuditRepository {
  constructor(private readonly db: DbClient) {}

  /** Inserts one audit row. Snapshots are redacted here, on every path. */
  async insert(entry: AuditEntry): Promise<void> {
    await this.db.auditLog.create({
      data: {
        actorId: entry.actorId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        before: jsonColumn(toAuditSnapshot(entry.before)),
        after: jsonColumn(toAuditSnapshot(entry.after)),
      },
    });
  }
}

// Prisma distinguishes SQL NULL (DbNull) from the JSON value null.
function jsonColumn(snapshot: JsonObject | null): Prisma.InputJsonObject | typeof Prisma.DbNull {
  return snapshot === null ? Prisma.DbNull : snapshot;
}
