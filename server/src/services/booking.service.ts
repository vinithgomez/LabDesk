import { resourceNotFound } from "../domain/errors.js";
import type { Actor, Booking } from "../domain/types.js";
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

      return tx.bookings.insert({
        resourceId: resource.id,
        userId: actor.id,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        purpose: input.purpose,
        attendeeCount: input.attendeeCount,
        idempotencyKey: input.idempotencyKey,
      });
    });
  }
}
