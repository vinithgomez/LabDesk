import { DomainError, incidentNotFound, resourceNotFound } from "../domain/errors.js";
import type { Actor, Incident, IncidentSeverity, Resource } from "../domain/types.js";
import type { IncidentFilter } from "../repositories/incident.repository.js";
import type { UnitOfWork } from "../repositories/index.js";

export type { IncidentFilter };

export interface ReportIncidentInput {
  resourceId: string;
  bookingId: string | null;
  severity: IncidentSeverity;
  description: string;
}

/** What `incident:report` is decided on. */
export interface ReportContext {
  resource: Resource;
  reporterHadBooking: boolean;
  bookingUserId: string | null;
}

export interface IncidentView {
  incident: Incident;
  resource: Resource;
}

/**
 * Incidents (CLAUDE.md §4): reported against a resource, optionally tied to
 * a booking, closed by resolving. Never deleted. Authorization is the
 * route's (incident:report / incident:view / incident:resolve).
 */
export class IncidentService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Loads what the route authorizes a report against. A named booking must
   * be on the same resource.
   */
  async reportContext(actor: Actor, resourceId: string, bookingId: string | null): Promise<ReportContext> {
    const resource = await this.uow.read.resources.findById(resourceId);
    if (!resource) throw resourceNotFound();
    let bookingUserId: string | null = null;
    if (bookingId !== null) {
      const booking = await this.uow.read.bookings.findById(bookingId);
      if (!booking || booking.resourceId !== resource.id) {
        throw new DomainError("VALIDATION_ERROR", "bookingId must be a booking on this resource");
      }
      bookingUserId = booking.userId;
    }
    return {
      resource,
      reporterHadBooking: await this.uow.read.bookings.hasHeldBooking(actor.id, resource.id),
      bookingUserId,
    };
  }

  report(actor: Actor, input: ReportIncidentInput): Promise<Incident> {
    return this.uow.transaction(async (tx) => {
      const incident = await tx.incidents.insert({ ...input, reportedBy: actor.id });
      await tx.writeAudit({
        actorId: actor.id,
        entityType: "incident",
        entityId: incident.id,
        action: "incident.reported",
        before: null,
        after: incident,
      });
      return incident;
    });
  }

  async get(id: string): Promise<IncidentView> {
    const incident = await this.uow.read.incidents.findById(id);
    if (!incident) throw incidentNotFound();
    const resource = await this.uow.read.resources.findById(incident.resourceId);
    if (!resource) throw incidentNotFound();
    return { incident, resource };
  }

  listForResource(resourceId: string, filter: IncidentFilter): Promise<Incident[]> {
    return this.uow.read.incidents.listForResource(resourceId, filter);
  }

  listMine(actor: Actor, filter: IncidentFilter): Promise<Incident[]> {
    return this.uow.read.incidents.listReportedBy(actor.id, filter);
  }

  /** Closes an incident once, recording who resolved it and how. */
  resolve(actor: Actor, id: string, resolution: string): Promise<Incident> {
    return this.uow.transaction(async (tx) => {
      await tx.incidents.lockById(id);
      const before = await tx.incidents.findById(id);
      if (!before) throw incidentNotFound();
      if (before.resolvedAt) throw new DomainError("INVALID_TRANSITION", "This incident is already resolved");
      const after = await tx.incidents.resolve(id, actor.id, this.now(), resolution);
      await tx.writeAudit({
        actorId: actor.id,
        entityType: "incident",
        entityId: id,
        action: "incident.resolved",
        before,
        after,
      });
      return after;
    });
  }
}
