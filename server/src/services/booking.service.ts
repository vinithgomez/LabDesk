import { DomainError, resourceNotFound } from "../domain/errors.js";
import type { Actor, Booking } from "../domain/types.js";
import { ConstraintViolation } from "../repositories/constraint-violation.js";
import type { UnitOfWork } from "../repositories/index.js";

export interface CreateBookingInput {
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  purpose: string;
  attendeeCount: number;
  idempotencyKey: string;
}

/**
 * Booking use cases. Authorization has already happened in the route via
 * `can()`; this layer enforces booking invariants.
 */
export class BookingService {
  constructor(private readonly uow: UnitOfWork) {}

  create(actor: Actor, input: CreateBookingInput): Promise<Booking> {
    return this.uow.transaction(async (tx) => {
      await tx.resources.lockForShare(input.resourceId);
      const resource = await tx.resources.findById(input.resourceId);
      if (!resource) throw resourceNotFound();

      try {
        return await tx.bookings.insert({
          resourceId: resource.id,
          userId: actor.id,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          purpose: input.purpose,
          attendeeCount: input.attendeeCount,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (err) {
        throw toSlotConflict(err);
      }
    });
  }
}

/** SQLSTATE 23P01 — exclusion_violation. */
const EXCLUSION_VIOLATION = "23P01";

/**
 * The overlap check is the database's (`bookings_no_overlap`); there is no
 * application-level pre-check. A violation means another holding booking
 * already covers part of the requested period.
 */
function toSlotConflict(err: unknown): unknown {
  if (
    err instanceof ConstraintViolation &&
    err.sqlState === EXCLUSION_VIOLATION &&
    err.constraint === "bookings_no_overlap"
  ) {
    return new DomainError("SLOT_CONFLICT", "That time slot overlaps an existing booking for this resource");
  }
  return err;
}
