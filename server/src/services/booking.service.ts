import { approvalProgress, type ApprovalProgress } from "../domain/approvals.js";
import type { AuditAction } from "../domain/audit.js";
import { assertBookableSlot } from "../domain/booking-rules.js";
import { bookingNotFound, DomainError, resourceNotFound } from "../domain/errors.js";
import type { Actor, Booking, BookingApproval, BookingListScope, BookingStatus, Resource } from "../domain/types.js";
import type { BookingListFilter, HeldSlot } from "../repositories/booking.repository.js";
import { IDEMPOTENCY_INDEX } from "../repositories/booking.repository.js";
import { ConstraintViolation } from "../repositories/constraint-violation.js";
import type { UnitOfWork } from "../repositories/index.js";
import type { MaintenanceSlot } from "../repositories/maintenance.repository.js";

export type { BookingListFilter };

export interface CreateBookingInput {
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  purpose: string;
  attendeeCount: number;
  idempotencyKey: string;
}

export interface CreateBookingResult {
  booking: Booking;
  /** True when the Idempotency-Key matched an earlier request; nothing was written. */
  replayed: boolean;
}

/** A booking together with the resource it is for, as authorization needs it. */
export interface BookingView {
  booking: Booking;
  resource: Resource;
}

/** Everything an approval decision is authorized and validated against. */
export interface ApprovalState extends BookingView {
  approvals: BookingApproval[];
  progress: ApprovalProgress;
}

export interface DecisionInput {
  /**
   * The level the caller was authorized to decide (ApprovalState.progress.
   * nextLevel when it called can()). transitionBooking re-reads the state
   * under a row lock and refuses if another decision landed in between.
   */
  level: number | null;
  comment: string;
}

export interface Availability {
  held: HeldSlot[];
  maintenance: MaintenanceSlot[];
}

/**
 * The booking state machine (CLAUDE.md §5). Phases 2–3 implement cancel,
 * approve and reject; Phase 4 adds check-in/out and the no-show sweeper.
 */
export type BookingAction = "cancel" | "approve" | "reject";
export type DecisionAction = Exclude<BookingAction, "cancel">;

const TRANSITIONS: Record<BookingAction, { from: readonly BookingStatus[]; to: BookingStatus }> = {
  // Cancel is forbidden once checked_in or completed (§5); terminal states stay terminal.
  cancel: { from: ["pending", "approved"], to: "cancelled" },
  // An approve on a multi-level booking records its level and only moves
  // the status once the final level approves.
  approve: { from: ["pending"], to: "approved" },
  // A rejection at any level is final; it never falls through to the next level.
  reject: { from: ["pending"], to: "rejected" },
};

/** SQLSTATE 23P01 — exclusion_violation. */
const EXCLUSION_VIOLATION = "23P01";
/** SQLSTATE 23505 — unique_violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * Booking use cases. Authorization has already happened in the route via
 * `can()`; this layer enforces booking invariants and owns every status write.
 */
export class BookingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Creates a 'pending' booking, idempotently per (user, Idempotency-Key).
   *
   * Order: replay lookup → resource re-check under a SHARE lock → slot rules
   * → maintenance windows → INSERT. Overlap with other bookings is never
   * pre-checked; the exclusion constraint rejects it at INSERT (23P01).
   */
  async create(actor: Actor, input: CreateBookingInput): Promise<CreateBookingResult> {
    try {
      return await this.uow.transaction(async (tx) => {
        const prior = await tx.bookings.findByIdempotencyKey(actor.id, input.idempotencyKey);
        if (prior) return replayOf(prior, input);

        // SHARE lock: concurrent bookings proceed together, while anything that
        // changes bookability (deactivation, and Phase 7's maintenance-window
        // creation) takes FOR UPDATE and so serializes against this transaction.
        await tx.resources.lockForShare(input.resourceId);
        const resource = await tx.resources.findById(input.resourceId);
        if (!resource) throw resourceNotFound();
        if (!resource.isActive) throw new DomainError("FORBIDDEN", "This resource is not accepting bookings");

        assertBookableSlot(resource, input, this.now());

        const windows = await tx.maintenance.overlapping(resource.id, input.startsAt, input.endsAt);
        if (windows.length > 0) {
          throw new DomainError("MAINTENANCE_BLOCKED", "That time overlaps a maintenance window for this resource");
        }

        let booking: Booking;
        try {
          booking = await tx.bookings.insert({
            // Resources that don't require approval skip the pending state.
            initialStatus: resource.requiresApproval ? "pending" : "approved",
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

        await tx.writeAudit({
          actorId: actor.id,
          entityType: "booking",
          entityId: booking.id,
          action: "booking.created",
          before: null,
          after: booking,
        });
        return { booking, replayed: false };
      });
    } catch (err) {
      // A concurrent request carrying the same key may have committed first:
      // our INSERT then fails on the idempotency index or on the overlap
      // constraint (whichever Postgres checks first). Either way, the right
      // answer is a replay of the winner.
      if (isSlotConflict(err) || isIdempotencyViolation(err)) {
        const prior = await this.uow.read.bookings.findByIdempotencyKey(actor.id, input.idempotencyKey);
        if (prior) return replayOf(prior, input);
      }
      throw err;
    }
  }

  async get(id: string): Promise<BookingView> {
    const booking = await this.uow.read.bookings.findById(id);
    if (!booking) throw bookingNotFound();
    const resource = await this.uow.read.resources.findById(booking.resourceId);
    if (!resource) throw bookingNotFound();
    return { booking, resource };
  }

  /** The booking, its resource and its approval progress, for booking:approve. */
  async getApprovalState(id: string): Promise<ApprovalState> {
    const view = await this.get(id);
    const approvals = await this.uow.read.approvals.listForBooking(id);
    return { ...view, approvals, progress: approvalProgress(view.resource, approvals) };
  }

  /** `scope` must come from the policy module (`bookingListScope`). */
  async list(scope: BookingListScope, filter: BookingListFilter): Promise<BookingView[]> {
    const bookings = await this.uow.read.bookings.list(scope, filter);
    const resources = await this.uow.read.resources.findManyByIds([...new Set(bookings.map((b) => b.resourceId))]);
    const byId = new Map(resources.map((r) => [r.id, r]));
    return bookings.flatMap((booking) => {
      const resource = byId.get(booking.resourceId);
      return resource ? [{ booking, resource }] : [];
    });
  }

  /**
   * The single place a booking's status changes (§5), and the only writer of
   * approval decisions. Callers must have passed the matching `can()` check
   * first (booking:cancel, or booking:approve for approve/reject).
   *
   * Runs under a FOR UPDATE lock on the booking, so concurrent decisions on
   * one booking serialize and each sees the other's result.
   */
  transitionBooking(bookingId: string, action: "cancel", actor: Actor): Promise<Booking>;
  transitionBooking(bookingId: string, action: DecisionAction, actor: Actor, decision: DecisionInput): Promise<Booking>;
  transitionBooking(
    bookingId: string,
    action: BookingAction,
    actor: Actor,
    decision?: DecisionInput,
  ): Promise<Booking> {
    const rule = TRANSITIONS[action];
    return this.uow.transaction(async (tx) => {
      await tx.bookings.lockById(bookingId);
      const before = await tx.bookings.findById(bookingId);
      if (!before) throw bookingNotFound();
      if (!rule.from.includes(before.status)) {
        throw new DomainError("INVALID_TRANSITION", `Cannot ${action} a booking that is ${before.status}`);
      }

      if (action === "cancel") {
        const after = await tx.bookings.updateStatus(bookingId, rule.to);
        await tx.writeAudit({
          actorId: actor.id,
          entityType: "booking",
          entityId: bookingId,
          action: "booking.cancelled",
          before,
          after,
        });
        // Phase 5: freeing a slot triggers waitlist promotion here.
        return after;
      }

      if (!decision) throw new Error(`${action} requires a decision`);
      const resource = await tx.resources.findById(before.resourceId);
      if (!resource) throw bookingNotFound();
      const approvals = await tx.approvals.listForBooking(bookingId);
      const progress = approvalProgress(resource, approvals);

      // The caller was authorized for a specific level. If another decision
      // landed first, that authorization no longer describes this booking.
      if (progress.nextLevel === null || progress.nextLevel !== decision.level) {
        throw new DomainError(
          "INVALID_TRANSITION",
          "This booking's approval state changed while you were deciding; reload and try again",
        );
      }
      // A pending booking whose start has passed can't usefully be approved;
      // it can still be rejected, which closes it out.
      if (action === "approve" && this.now().getTime() >= before.startsAt.getTime()) {
        throw new DomainError("INVALID_TRANSITION", "This booking has already started and can no longer be approved");
      }

      let approval: BookingApproval;
      try {
        approval = await tx.approvals.insert({
          bookingId,
          level: progress.nextLevel,
          approverId: actor.id,
          decision: action === "approve" ? "approved" : "rejected",
          comment: decision.comment,
        });
      } catch (err) {
        if (err instanceof ConstraintViolation && err.sqlState === UNIQUE_VIOLATION) {
          // Backstop for UNIQUE(booking_id, level) / (booking_id, approver_id).
          throw new DomainError("INVALID_TRANSITION", "This approval decision has already been made");
        }
        throw err;
      }

      const final = action === "reject" || progress.nextLevel === progress.requiredLevels;
      const after = final ? await tx.bookings.updateStatus(bookingId, rule.to) : before;
      const auditAction: AuditAction =
        action === "reject" ? "booking.rejected" : final ? "booking.approved" : "booking.level_approved";
      await tx.writeAudit({
        actorId: actor.id,
        entityType: "booking",
        entityId: bookingId,
        action: auditAction,
        before: { ...before, approvals },
        after: { ...after, approvals: [...approvals, approval] },
      });
      // Phase 5: a rejection frees the slot and triggers waitlist promotion here.
      return after;
    });
  }

  /** Slot-holding bookings and maintenance windows overlapping [from, to). */
  async availability(resourceId: string, from: Date, to: Date): Promise<Availability> {
    const [held, maintenance] = await Promise.all([
      this.uow.read.bookings.heldSlots(resourceId, from, to),
      this.uow.read.maintenance.overlapping(resourceId, from, to),
    ]);
    return { held, maintenance };
  }
}

/**
 * A replay returns the original booking only if the request is the same
 * request. Reusing a key for a different booking is a client bug and must not
 * silently return an unrelated booking.
 */
function replayOf(prior: Booking, input: CreateBookingInput): CreateBookingResult {
  const same =
    prior.resourceId === input.resourceId &&
    prior.startsAt.getTime() === input.startsAt.getTime() &&
    prior.endsAt.getTime() === input.endsAt.getTime() &&
    prior.purpose === input.purpose &&
    prior.attendeeCount === input.attendeeCount;
  if (!same) {
    throw new DomainError(
      "IDEMPOTENCY_KEY_REUSED",
      "This Idempotency-Key was already used for a different booking request",
    );
  }
  return { booking: prior, replayed: true };
}

/**
 * The overlap check is the database's (`bookings_no_overlap`). A violation
 * means another slot-holding booking already covers part of the period.
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

function isSlotConflict(err: unknown): boolean {
  return err instanceof DomainError && err.code === "SLOT_CONFLICT";
}

function isIdempotencyViolation(err: unknown): boolean {
  return (
    err instanceof ConstraintViolation &&
    err.sqlState === UNIQUE_VIOLATION &&
    err.constraint === IDEMPOTENCY_INDEX
  );
}
