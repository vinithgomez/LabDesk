import { DomainError, maintenanceNotFound, resourceNotFound } from "../domain/errors.js";
import type { Actor, Booking, MaintenanceWindow, Resource } from "../domain/types.js";
import { ConstraintViolation } from "../repositories/constraint-violation.js";
import type { UnitOfWork } from "../repositories/index.js";
import { MAINTENANCE_OVERLAP_CONSTRAINT } from "../repositories/maintenance.repository.js";
import type { BookingService } from "./booking.service.js";

export interface CreateMaintenanceInput {
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
}

export interface MaintenanceCreated {
  window: MaintenanceWindow;
  /** Bookings the window cancelled, in time order. */
  cancelled: Booking[];
}

export interface MaintenanceView {
  window: MaintenanceWindow;
  resource: Resource;
}

/** SQLSTATE 23P01 — exclusion_violation. */
const EXCLUSION_VIOLATION = "23P01";
const LIST_LIMIT = 200;

/**
 * Maintenance windows (CLAUDE.md §2c, §4). A window records that a resource
 * is unusable, so it can always be created whatever is booked: every
 * booking holding a slot it overlaps is cancelled in the same transaction.
 * Authorization (maintenance:create / maintenance:remove) is the route's.
 */
export class MaintenanceService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bookings: BookingService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Takes the resource row FOR UPDATE first. Booking inserts hold it FOR
   * SHARE (BookingService.insertInTx), so the two serialize: a booking in
   * flight finishes (and is then cancelled here), and a booking arriving
   * after this lock waits, then sees the committed window and is refused
   * with MAINTENANCE_BLOCKED. Neither can slip in between the other's
   * check and write.
   */
  async create(actor: Actor, input: CreateMaintenanceInput): Promise<MaintenanceCreated> {
    if (input.endsAt.getTime() <= this.now().getTime()) {
      throw new DomainError("VALIDATION_ERROR", "A maintenance window must end in the future");
    }
    return this.uow.transaction(async (tx) => {
      await tx.resources.lockById(input.resourceId);
      const resource = await tx.resources.findById(input.resourceId);
      if (!resource) throw resourceNotFound();

      let window: MaintenanceWindow;
      try {
        window = await tx.maintenance.insert({ ...input, createdBy: actor.id });
      } catch (err) {
        if (
          err instanceof ConstraintViolation &&
          err.sqlState === EXCLUSION_VIOLATION &&
          err.constraint === MAINTENANCE_OVERLAP_CONSTRAINT
        ) {
          throw new DomainError("MAINTENANCE_OVERLAP", "This resource already has maintenance scheduled during that time");
        }
        throw err;
      }

      const cancelled: Booking[] = [];
      for (const id of await tx.bookings.listHeldOverlapping(resource.id, window.startsAt, window.endsAt)) {
        cancelled.push(await this.bookings.cancelForMaintenanceWithin(tx, id, actor, window));
      }

      await tx.writeAudit({
        actorId: actor.id,
        entityType: "maintenance_window",
        entityId: window.id,
        action: "maintenance.created",
        before: null,
        after: { ...window, cancelledBookingIds: cancelled.map((b) => b.id) },
      });
      return { window, cancelled };
    });
  }

  async get(id: string): Promise<MaintenanceView> {
    const window = await this.uow.read.maintenance.findById(id);
    if (!window) throw maintenanceNotFound();
    const resource = await this.uow.read.resources.findById(window.resourceId);
    if (!resource) throw maintenanceNotFound();
    return { window, resource };
  }

  /** A resource's live windows that haven't ended yet. */
  listUpcoming(resourceId: string): Promise<MaintenanceWindow[]> {
    return this.uow.read.maintenance.listForResource(resourceId, this.now(), LIST_LIMIT);
  }

  /**
   * Soft-deletes a window: it stops blocking bookings (the waitlist promoter
   * then picks up the freed time). Bookings it already cancelled stay
   * cancelled — rebooking is the booker's call.
   */
  async remove(actor: Actor, id: string): Promise<MaintenanceWindow> {
    return this.uow.transaction(async (tx) => {
      await tx.maintenance.lockById(id);
      const before = await tx.maintenance.findById(id);
      if (!before) throw maintenanceNotFound();
      if (before.removedAt) throw new DomainError("INVALID_TRANSITION", "This maintenance window was already removed");
      const after = await tx.maintenance.markRemoved(id, actor.id, this.now());
      await tx.writeAudit({
        actorId: actor.id,
        entityType: "maintenance_window",
        entityId: id,
        action: "maintenance.removed",
        before,
        after,
      });
      return after;
    });
  }
}
