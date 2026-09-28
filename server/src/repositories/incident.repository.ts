import type { DbClient } from "../db/prisma.js";
import type { TxClient } from "../db/transaction.js";
import type { Incident, IncidentSeverity } from "../domain/types.js";

const incidentSelect = {
  id: true,
  resourceId: true,
  bookingId: true,
  reportedBy: true,
  severity: true,
  description: true,
  createdAt: true,
  resolvedAt: true,
  resolvedBy: true,
  resolution: true,
} as const;

export interface IncidentFilter {
  /** "open" = unresolved, "resolved", or everything. */
  state: "open" | "resolved" | "all";
  limit: number;
}

const stateWhere = (state: IncidentFilter["state"]) =>
  state === "open" ? { resolvedAt: null } : state === "resolved" ? { resolvedAt: { not: null } } : {};

/** Read-only incident queries (`uow.read.incidents`). */
export class IncidentReader {
  constructor(protected readonly db: DbClient) {}

  findById(id: string): Promise<Incident | null> {
    return this.db.incident.findUnique({ where: { id }, select: incidentSelect });
  }

  /** A resource's incidents, newest first. */
  listForResource(resourceId: string, filter: IncidentFilter): Promise<Incident[]> {
    return this.db.incident.findMany({
      where: { resourceId, ...stateWhere(filter.state) },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: filter.limit,
      select: incidentSelect,
    });
  }

  /** Incidents a user reported, newest first. */
  listReportedBy(userId: string, filter: IncidentFilter): Promise<Incident[]> {
    return this.db.incident.findMany({
      where: { reportedBy: userId, ...stateWhere(filter.state) },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: filter.limit,
      select: incidentSelect,
    });
  }
}

/** Incident writes: TxClient only, each committed with its audit row. */
export class IncidentWriter extends IncidentReader {
  constructor(private readonly tx: TxClient) {
    super(tx);
  }

  insert(i: {
    resourceId: string;
    bookingId: string | null;
    reportedBy: string;
    severity: IncidentSeverity;
    description: string;
  }): Promise<Incident> {
    return this.tx.incident.create({ data: i, select: incidentSelect });
  }

  async lockById(id: string): Promise<void> {
    await this.tx.$executeRaw`SELECT 1 FROM incidents WHERE id = ${id}::uuid FOR UPDATE`;
  }

  resolve(id: string, by: string, at: Date, resolution: string): Promise<Incident> {
    return this.tx.incident.update({
      where: { id },
      data: { resolvedAt: at, resolvedBy: by, resolution },
      select: incidentSelect,
    });
  }
}
