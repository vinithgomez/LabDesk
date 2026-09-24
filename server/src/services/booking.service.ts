import { approvalProgress, isStalled, type ApprovalProgress } from "../domain/approvals.js";
import type { AuditAction } from "../domain/audit.js";
import { assertBookableSlot } from "../domain/booking-rules.js";
import {
  CHECKIN_TOLERANCE_MS,
  checkInWindow,
  checkOutWindow,
  isAutoCompleteDue,
  isLapsedPending,
  isNoShowDue,
  isWithin,
  NO_SHOW_GRACE_MS,
} from "../domain/checkin-rules.js";
import { bookingNotFound, DomainError, resourceNotFound } from "../domain/errors.js";
import type {
  Actor,
  ApprovalInboxScope,
  Booking,
  BookingApproval,
  BookingListScope,
  BookingStatus,
  Checkin,
  CheckinMethod,
  Resource,
} from "../domain/types.js";
import type { BookingListFilter, HeldSlot } from "../repositories/booking.repository.js";
import { IDEMPOTENCY_INDEX } from "../repositories/booking.repository.js";
import { ConstraintViolation } from "../repositories/constraint-violation.js";
import type { TxRepositories, UnitOfWork } from "../repositories/index.js";
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

/**
 * An approvals-inbox entry. `stalled` and `lapsed` are computed on read, so
 * neither needs a background job (see src/domain/approvals.ts).
 */
export interface InboxItem extends ApprovalState {
  /** When the awaited level started waiting: the last decision, or creation. */
  awaitingSince: Date;
  /** Partially approved and the next level has waited >= STALL_AFTER_MS. */
  stalled: boolean;
  /** The booking's start has passed: it can only be rejected now. */
  lapsed: boolean;
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
 * The booking state machine (CLAUDE.md §5). User actions: cancel, approve,
 * reject, checkin, checkout. System actions (actor null, run by jobs):
 * no_show, auto_complete, expire.
 */
export type BookingAction =
  | "cancel"
  | "approve"
  | "reject"
  | "checkin"
  | "checkout"
  | "no_show"
  | "auto_complete"
  | "expire";
export type DecisionAction = "approve" | "reject";
export type AttendanceAction = "checkin" | "checkout";
export type SystemAction = "no_show" | "auto_complete" | "expire";

export interface AttendanceInput {
  /** 'manual_override' records the acting staff member as overridden_by. */
  method: CheckinMethod;
}

const TRANSITIONS: Record<BookingAction, { from: readonly BookingStatus[]; to: BookingStatus }> = {
  // Cancel is forbidden once checked_in or completed (§5); terminal states stay terminal.
  cancel: { from: ["pending", "approved"], to: "cancelled" },
  // An approve on a multi-level booking records its level and only moves
  // the status once the final level approves.
  approve: { from: ["pending"], to: "approved" },
  // A rejection at any level is final; it never falls through to the next level.
  reject: { from: ["pending"], to: "rejected" },
  checkin: { from: ["approved"], to: "checked_in" },
  checkout: { from: ["checked_in"], to: "completed" },
  // Sweeper: approved, never checked in, past start + grace.
  no_show: { from: ["approved"], to: "no_show" },
  // Checked in but never checked out, past end + tolerance.
  auto_complete: { from: ["checked_in"], to: "completed" },
  // A pending booking that reached its start undecided: 'rejected' (not
  // approved in time), which also frees the slot. No approval row is written;
  // approvals are human decisions.
  expire: { from: ["pending"], to: "rejected" },
};

/** What one scheduled-job run did. A second run on unchanged data reports changed: 0. */
export interface JobResult {
  /** Rows the eligibility query returned. */
  candidates: number;
  /** Rows actually transitioned. */
  changed: number;
  /** Candidates that were no longer eligible under the row lock (raced). */
  skipped: number;
  /** Candidates whose transition failed unexpectedly (logged, not retried). */
  failed: number;
}

/** Upper bound on rows one job run processes; the next run picks up the rest. */
const JOB_BATCH_SIZE = 500;

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

  /** `scope` must come from the policy module (`approvalInboxScope`). */
  async inbox(scope: ApprovalInboxScope, limit: number): Promise<InboxItem[]> {
    const bookings = await this.uow.read.bookings.listPendingForInbox(scope, limit);
    const ids = bookings.map((b) => b.id);
    const [resources, approvals] = await Promise.all([
      this.uow.read.resources.findManyByIds([...new Set(bookings.map((b) => b.resourceId))]),
      this.uow.read.approvals.listForBookings(ids),
    ]);
    const resourceById = new Map(resources.map((r) => [r.id, r]));
    const now = this.now();

    return bookings.flatMap((booking) => {
      const resource = resourceById.get(booking.resourceId);
      if (!resource) return [];
      const own = approvals.filter((a) => a.bookingId === booking.id);
      const progress = approvalProgress(resource, own);
      const lastDecision = own.reduce<Date | null>(
        (latest, a) => (latest === null || a.decidedAt > latest ? a.decidedAt : latest),
        null,
      );
      const awaitingSince = lastDecision ?? booking.createdAt;
      return [
        {
          booking,
          resource,
          approvals: own,
          progress,
          awaitingSince,
          stalled: isStalled(progress, awaitingSince, now),
          lapsed: booking.startsAt.getTime() <= now.getTime(),
        },
      ];
    });
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
   * approval decisions and check-in rows. Callers must have passed the
   * matching `can()` check first (booking:cancel, booking:approve,
   * checkin:create / checkin:override); system actions are run by jobs.
   *
   * Runs under a FOR UPDATE lock on the booking, so concurrent transitions on
   * one booking serialize and each sees the other's result. Every
   * time-dependent precondition is re-checked here, under the lock.
   */
  transitionBooking(bookingId: string, action: "cancel", actor: Actor): Promise<Booking>;
  transitionBooking(bookingId: string, action: DecisionAction, actor: Actor, decision: DecisionInput): Promise<Booking>;
  transitionBooking(
    bookingId: string,
    action: AttendanceAction,
    actor: Actor,
    attendance: AttendanceInput,
  ): Promise<Booking>;
  transitionBooking(bookingId: string, action: SystemAction, actor: null): Promise<Booking>;
  transitionBooking(
    bookingId: string,
    action: BookingAction,
    actor: Actor | null,
    input?: DecisionInput | AttendanceInput,
  ): Promise<Booking> {
    const rule = TRANSITIONS[action];
    return this.uow.transaction(async (tx) => {
      await tx.bookings.lockById(bookingId);
      const before = await tx.bookings.findById(bookingId);
      if (!before) throw bookingNotFound();
      if (!rule.from.includes(before.status)) {
        throw new DomainError("INVALID_TRANSITION", `Cannot ${action} a booking that is ${before.status}`);
      }
      const step = { tx, before, to: rule.to, now: this.now() };

      switch (action) {
        case "cancel":
          return this.applyCancel(step, requireActor(actor, action));
        case "approve":
        case "reject":
          return this.applyDecision(step, action, requireActor(actor, action), requireDecision(input, action));
        case "checkin":
        case "checkout":
          return this.applyAttendance(step, action, requireActor(actor, action), requireAttendance(input, action));
        case "no_show":
        case "auto_complete":
        case "expire":
          return this.applySystem(step, action);
      }
    });
  }

  private async applyCancel(step: TransitionStep, actor: Actor): Promise<Booking> {
    const { tx, before, to } = step;
    const after = await tx.bookings.updateStatus(before.id, to);
    await tx.writeAudit({
      actorId: actor.id,
      entityType: "booking",
      entityId: before.id,
      action: "booking.cancelled",
      before,
      after,
    });
    // Phase 5: freeing a slot triggers waitlist promotion here.
    return after;
  }

  private async applyDecision(
    step: TransitionStep,
    action: DecisionAction,
    actor: Actor,
    decision: DecisionInput,
  ): Promise<Booking> {
    const { tx, before, to, now } = step;
    const resource = await tx.resources.findById(before.resourceId);
    if (!resource) throw bookingNotFound();
    const approvals = await tx.approvals.listForBooking(before.id);
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
    if (action === "approve" && isLapsedPending(before, now)) {
      throw new DomainError("INVALID_TRANSITION", "This booking has already started and can no longer be approved");
    }

    let approval: BookingApproval;
    try {
      approval = await tx.approvals.insert({
        bookingId: before.id,
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
    const after = final ? await tx.bookings.updateStatus(before.id, to) : before;
    const auditAction: AuditAction =
      action === "reject" ? "booking.rejected" : final ? "booking.approved" : "booking.level_approved";
    await tx.writeAudit({
      actorId: actor.id,
      entityType: "booking",
      entityId: before.id,
      action: auditAction,
      before: { ...before, approvals },
      after: { ...after, approvals: [...approvals, approval] },
    });
    // Phase 5: a rejection frees the slot and triggers waitlist promotion here.
    return after;
  }

  /** First scan -> checked_in; second scan during the session -> completed (§7). */
  private async applyAttendance(
    step: TransitionStep,
    action: AttendanceAction,
    actor: Actor,
    attendance: AttendanceInput,
  ): Promise<Booking> {
    const { tx, before, to, now } = step;
    const overriddenBy = attendance.method === "manual_override" ? actor.id : null;
    const existing = await tx.checkins.findByBookingId(before.id);

    let checkin: Checkin;
    if (action === "checkin") {
      const window = checkInWindow(before);
      if (!isWithin(window, now)) {
        throw new DomainError(
          "INVALID_TRANSITION",
          `Check-in is open from ${window.opensAt.toISOString()} to ${window.closesAt.toISOString()}`,
        );
      }
      if (existing) throw new DomainError("INVALID_TRANSITION", "This booking has already been checked in");
      checkin = await tx.checkins.checkIn({ bookingId: before.id, at: now, method: attendance.method, overriddenBy });
    } else {
      const window = checkOutWindow(before);
      if (!existing) throw new DomainError("INVALID_TRANSITION", "This booking was never checked in");
      if (!isWithin(window, now)) {
        throw new DomainError("INVALID_TRANSITION", `Check-out closed at ${window.closesAt.toISOString()}`);
      }
      checkin = await tx.checkins.checkOut({ bookingId: before.id, at: now, method: attendance.method, overriddenBy });
    }

    const after = await tx.bookings.updateStatus(before.id, to);
    const manual = attendance.method === "manual_override";
    await tx.writeAudit({
      actorId: actor.id,
      entityType: "booking",
      entityId: before.id,
      action:
        action === "checkin"
          ? manual
            ? "booking.checkin_overridden"
            : "booking.checked_in"
          : manual
            ? "booking.checkout_overridden"
            : "booking.checked_out",
      before: { ...before, checkin: existing },
      after: { ...after, checkin },
    });
    return after;
  }

  /** Job-driven transitions: audited with actor_id null. */
  private async applySystem(step: TransitionStep, action: SystemAction): Promise<Booking> {
    const { tx, before, to, now } = step;
    const existing = await tx.checkins.findByBookingId(before.id);
    let checkin: Checkin | null = existing;
    let auditAction: AuditAction;

    switch (action) {
      case "no_show":
        if (!isNoShowDue(before, now) || existing) {
          throw new DomainError("INVALID_TRANSITION", "This booking is not (or no longer) a no-show");
        }
        auditAction = "booking.no_show";
        break;
      case "auto_complete":
        if (!isAutoCompleteDue(before, now) || !existing) {
          throw new DomainError("INVALID_TRANSITION", "This session is not due for auto-completion");
        }
        // The session is closed at the booked end, not at the time the job ran.
        checkin = await tx.checkins.checkOut({ bookingId: before.id, at: before.endsAt, method: "auto", overriddenBy: null });
        auditAction = "booking.auto_completed";
        break;
      case "expire":
        if (!isLapsedPending(before, now)) {
          throw new DomainError("INVALID_TRANSITION", "This booking has not reached its start yet");
        }
        auditAction = "booking.expired";
        break;
    }

    const after = await tx.bookings.updateStatus(before.id, to);
    await tx.writeAudit({
      actorId: null,
      entityType: "booking",
      entityId: before.id,
      action: auditAction,
      before: { ...before, checkin: existing },
      after: { ...after, checkin },
    });
    // Phase 5: no_show and expire free the slot; waitlist promotion hooks in here.
    return after;
  }

  /** No-show sweeper (§8): approved bookings never checked in, past start + grace. */
  async runNoShowSweep(): Promise<JobResult> {
    const ids = await this.uow.read.bookings.listNoShowDue(this.now(), NO_SHOW_GRACE_MS, JOB_BATCH_SIZE);
    return this.transitionEach(ids, "no_show");
  }

  /** Auto-complete (§8): checked-in sessions never checked out, past end + tolerance. */
  async runAutoComplete(): Promise<JobResult> {
    const ids = await this.uow.read.bookings.listAutoCompleteDue(this.now(), CHECKIN_TOLERANCE_MS, JOB_BATCH_SIZE);
    return this.transitionEach(ids, "auto_complete");
  }

  /** Lapsed-pending expiry (§2c): pending bookings that reached their start undecided. */
  async runLapsedPendingExpiry(): Promise<JobResult> {
    const ids = await this.uow.read.bookings.listLapsedPending(this.now(), JOB_BATCH_SIZE);
    return this.transitionEach(ids, "expire");
  }

  /**
   * One transaction per booking, so one failure never rolls back the rest.
   * Idempotent: eligibility is re-checked under each row lock, and a booking
   * that no longer qualifies is skipped, so a second run changes nothing.
   */
  private async transitionEach(ids: readonly string[], action: SystemAction): Promise<JobResult> {
    const result: JobResult = { candidates: ids.length, changed: 0, skipped: 0, failed: 0 };
    for (const id of ids) {
      try {
        await this.transitionBooking(id, action, null);
        result.changed += 1;
      } catch (err) {
        if (err instanceof DomainError && err.code === "INVALID_TRANSITION") result.skipped += 1;
        else result.failed += 1;
      }
    }
    return result;
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

interface TransitionStep {
  tx: TxRepositories;
  before: Booking;
  to: BookingStatus;
  now: Date;
}

function requireActor(actor: Actor | null, action: BookingAction): Actor {
  if (!actor) throw new Error(`${action} requires an actor`);
  return actor;
}

function requireDecision(input: DecisionInput | AttendanceInput | undefined, action: BookingAction): DecisionInput {
  if (!input || !("level" in input)) throw new Error(`${action} requires a decision`);
  return input;
}

function requireAttendance(input: DecisionInput | AttendanceInput | undefined, action: BookingAction): AttendanceInput {
  if (!input || !("method" in input)) throw new Error(`${action} requires an attendance method`);
  return input;
}

