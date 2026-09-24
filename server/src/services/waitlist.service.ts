import type { AuditAction } from "../domain/audit.js";
import { assertBookableSlot } from "../domain/booking-rules.js";
import { DomainError, resourceNotFound, waitlistEntryNotFound } from "../domain/errors.js";
import type { Actor, Booking, WaitlistEntry, WaitlistStatus } from "../domain/types.js";
import { ConstraintViolation } from "../repositories/constraint-violation.js";
import type { UnitOfWork } from "../repositories/index.js";
import { WAITLIST_DUPLICATE_CONSTRAINT } from "../repositories/waitlist.repository.js";
import { assertMayBook, JOB_BATCH_SIZE, type BookingService, type JobResult } from "./booking.service.js";

export interface JoinWaitlistInput {
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  purpose: string;
  attendeeCount: number;
}

export interface Promotion {
  entry: WaitlistEntry;
  booking: Booking;
}

/** What one promoter run did. */
export type PromotionResult = {
  /** Waiting entries whose desired period looked free when the run started. */
  candidates: number;
  promoted: number;
  /**
   * Candidates that could not be booked: an older entry in the same run took
   * an overlapping slot (SLOT_CONFLICT), or the entry no longer passes the
   * booking rules. They stay 'waiting' and are retried next run, until expiry.
   */
  blocked: number;
  failed: number;
};

type EntryAction = "cancel" | "expire";

const TRANSITIONS: Record<EntryAction, { to: WaitlistStatus; audit: AuditAction }> = {
  cancel: { to: "cancelled", audit: "waitlist.cancelled" },
  expire: { to: "expired", audit: "waitlist.expired" },
};

/** SQLSTATE 23P01 — exclusion_violation. */
const EXCLUSION_VIOLATION = "23P01";

/**
 * An entry can be promoted only while its desired start is still ahead; from
 * that instant on it can only expire. Same boundary as lapsed-pending expiry
 * (now >= start), and the same instant booking creation stops accepting the
 * slot, so no moment is claimed by both jobs or by neither.
 */
const desiredStartHasArrived = (e: Pick<WaitlistEntry, "startsAt">, now: Date): boolean =>
  now.getTime() >= e.startsAt.getTime();

/**
 * Waitlist use cases (CLAUDE.md §4 waitlist_entries, §8). Authorization has
 * already happened in the route via `can()`; this layer owns every entry
 * status change. Only 'waiting' entries ever change: waiting -> promoted |
 * expired | cancelled, and those three are terminal.
 */
export class WaitlistService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bookings: BookingService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Joins the waitlist for a slot someone currently holds. The desired period
   * must pass every rule a booking would (it becomes one on promotion); a slot
   * nobody holds is refused with SLOT_AVAILABLE, since it can simply be booked.
   *
   * The "is it held?" check is a read, not a guarantee: if the holder cancels
   * a moment later, the entry just waits for the promoter's next run.
   */
  async join(actor: Actor, input: JoinWaitlistInput): Promise<WaitlistEntry> {
    return this.uow.transaction(async (tx) => {
      await tx.resources.lockForShare(input.resourceId);
      const resource = await tx.resources.findById(input.resourceId);
      if (!resource) throw resourceNotFound();
      if (!resource.isActive) throw new DomainError("FORBIDDEN", "This resource is not accepting bookings");

      assertBookableSlot(resource, input, this.now());

      const windows = await tx.maintenance.overlapping(resource.id, input.startsAt, input.endsAt);
      if (windows.length > 0) {
        throw new DomainError("MAINTENANCE_BLOCKED", "That time overlaps a maintenance window for this resource");
      }
      const held = await tx.bookings.heldSlots(resource.id, input.startsAt, input.endsAt);
      if (held.length === 0) {
        throw new DomainError("SLOT_AVAILABLE", "That time is free; book it directly instead of joining the waitlist");
      }

      let entry: WaitlistEntry;
      try {
        entry = await tx.waitlist.insert({ ...input, userId: actor.id });
      } catch (err) {
        if (
          err instanceof ConstraintViolation &&
          err.sqlState === EXCLUSION_VIOLATION &&
          err.constraint === WAITLIST_DUPLICATE_CONSTRAINT
        ) {
          throw new DomainError("WAITLIST_DUPLICATE", "You are already on the waitlist for an overlapping time");
        }
        throw err;
      }

      await tx.writeAudit({
        actorId: actor.id,
        entityType: "waitlist_entry",
        entityId: entry.id,
        action: "waitlist.joined",
        before: null,
        after: entry,
      });
      return entry;
    });
  }

  async get(id: string): Promise<WaitlistEntry> {
    const entry = await this.uow.read.waitlist.findById(id);
    if (!entry) throw waitlistEntryNotFound();
    return entry;
  }

  listMine(actor: Actor, statuses: readonly WaitlistStatus[] | undefined, limit: number): Promise<WaitlistEntry[]> {
    return this.uow.read.waitlist.listForUser(actor.id, statuses, limit);
  }

  /** Leaves the waitlist. Callers must have passed `can(actor, "waitlist:cancel", …)`. */
  cancel(actor: Actor, id: string): Promise<WaitlistEntry> {
    return this.transition(id, "cancel", actor.id);
  }

  /**
   * Promotes one entry: books its desired period for its owner through the
   * shared booking-insert path (BookingService.insertInTx — resource lock,
   * slot rules, maintenance check, advisory lock, exclusion constraint), then
   * marks the entry 'promoted', all in one transaction. If the insert is
   * rejected, nothing is written and the entry stays 'waiting'.
   *
   * The booking starts 'pending' or 'approved' by the resource's
   * requires_approval rule, like any other: promotion is not approval.
   */
  async promote(entryId: string): Promise<Promotion> {
    return this.uow.transaction(async (tx) => {
      await tx.waitlist.lockById(entryId);
      const before = await tx.waitlist.findById(entryId);
      if (!before) throw waitlistEntryNotFound();
      if (before.status !== "waiting") {
        throw new DomainError("INVALID_TRANSITION", `Cannot promote a waitlist entry that is ${before.status}`);
      }
      if (desiredStartHasArrived(before, this.now())) {
        throw new DomainError("INVALID_TRANSITION", "This entry's desired start has passed; it can only expire");
      }

      await tx.resources.lockForShare(before.resourceId);
      const resource = await tx.resources.findById(before.resourceId);
      if (!resource) throw resourceNotFound();
      assertMayBook(await tx.users.findById(before.userId), resource);

      const booking = await this.bookings.insertInTx(
        tx,
        {
          resourceId: before.resourceId,
          userId: before.userId,
          startsAt: before.startsAt,
          endsAt: before.endsAt,
          purpose: before.purpose,
          attendeeCount: before.attendeeCount,
          idempotencyKey: null,
          seriesId: null,
        },
        null,
      );
      const after = await tx.waitlist.updateStatus(entryId, "promoted", booking.id);
      await tx.writeAudit({
        actorId: null,
        entityType: "waitlist_entry",
        entityId: entryId,
        action: "waitlist.promoted",
        before,
        after,
      });
      return { entry: after, booking };
    });
  }

  /**
   * Waitlist promoter (§8). Entries whose desired period is currently clear
   * are tried oldest first, each in its own transaction; when two of them
   * overlap, the older is booked first and the exclusion constraint rejects
   * the newer, which keeps waiting. An older entry whose period is still
   * partly held does not block a newer one that fits (see listPromotable).
   *
   * Idempotent: a promoted entry is no longer 'waiting', and its booking now
   * holds the slot, so a second run finds nothing new to do.
   */
  async runPromotion(): Promise<PromotionResult> {
    const ids = await this.uow.read.waitlist.listPromotable(this.now(), JOB_BATCH_SIZE);
    const result: PromotionResult = { candidates: ids.length, promoted: 0, blocked: 0, failed: 0 };
    for (const id of ids) {
      try {
        await this.promote(id);
        result.promoted += 1;
      } catch (err) {
        if (err instanceof DomainError) result.blocked += 1;
        else result.failed += 1;
      }
    }
    return result;
  }

  /**
   * Waitlist expiry: 'waiting' entries whose desired start has arrived move to
   * 'expired'. Idempotent like the other jobs: eligibility is re-checked under
   * each row lock, and an expired entry is never 'waiting' again.
   */
  async runExpiry(): Promise<JobResult> {
    const ids = await this.uow.read.waitlist.listExpiryDue(this.now(), JOB_BATCH_SIZE);
    const result: JobResult = { candidates: ids.length, changed: 0, skipped: 0, failed: 0 };
    for (const id of ids) {
      try {
        await this.transition(id, "expire", null);
        result.changed += 1;
      } catch (err) {
        if (err instanceof DomainError && err.code === "INVALID_TRANSITION") result.skipped += 1;
        else result.failed += 1;
      }
    }
    return result;
  }

  /** The only status writer for cancel/expire, under a row lock, audited. */
  private transition(id: string, action: EntryAction, actorId: string | null): Promise<WaitlistEntry> {
    const rule = TRANSITIONS[action];
    return this.uow.transaction(async (tx) => {
      await tx.waitlist.lockById(id);
      const before = await tx.waitlist.findById(id);
      if (!before) throw waitlistEntryNotFound();
      if (before.status !== "waiting") {
        throw new DomainError("INVALID_TRANSITION", `Cannot ${action} a waitlist entry that is ${before.status}`);
      }
      if (action === "expire" && !desiredStartHasArrived(before, this.now())) {
        throw new DomainError("INVALID_TRANSITION", "This entry's desired start has not arrived yet");
      }
      const after = await tx.waitlist.updateStatus(id, rule.to);
      await tx.writeAudit({
        actorId,
        entityType: "waitlist_entry",
        entityId: id,
        action: rule.audit,
        before,
        after,
      });
      return after;
    });
  }
}
