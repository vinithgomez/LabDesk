import { assertCapacity, assertSlotLength, horizonEnd } from "../domain/booking-rules.js";
import { DomainError, resourceNotFound, seriesNotFound } from "../domain/errors.js";
import { formatWeeklyRule, nextOccurrence, occurrencesBetween, parseWeeklyRule, type Occurrence } from "../domain/rrule.js";
import type { Actor, Booking, BookingSeries, Resource, SeriesSkip } from "../domain/types.js";
import type { UnitOfWork } from "../repositories/index.js";
import { assertMayBook, JOB_BATCH_SIZE, type BookingService } from "./booking.service.js";

export interface CreateSeriesInput {
  resourceId: string;
  rrule: string;
  /** IST wall-clock "HH:MM". */
  startTime: string;
  durationMinutes: number;
  purpose: string;
  attendeeCount: number;
}

/** A series with its resource, its materialized bookings and its skipped occurrences. */
export interface SeriesDetail {
  series: BookingSeries;
  resource: Resource;
  occurrences: Booking[];
  skipped: SeriesSkip[];
}

/** What materializing one series did. */
export interface MaterializeOutcome {
  created: number;
  skipped: number;
  /**
   * The series was not materialized this run because its resource is inactive
   * or its owner can no longer book it. Nothing is recorded as skipped; it
   * resumes once that changes, for occurrences still ahead.
   */
  paused: boolean;
}

/** What one materializer run did. */
export type MaterializerResult = {
  series: number;
  created: number;
  skipped: number;
  paused: number;
  failed: number;
};

/**
 * Thrown inside an occurrence's transaction when the series was cancelled or
 * another run already processed that occurrence: nothing is written, and this
 * run stops working on the series.
 */
class StaleSeries extends Error {}

/**
 * Recurring bookings (CLAUDE.md §4 booking_series, §8). Occurrences are
 * ordinary bookings with series_id set, created through the shared insert
 * path (BookingService.insertInTx), so each one meets the same rules and the
 * same exclusion constraint as any other booking.
 *
 * Materialization walks occurrences in time order, one transaction each,
 * under the series row lock. `materialized_through` records the start of the
 * last occurrence processed; an occurrence at or before it is never tried
 * again. An occurrence that can't be booked (SLOT_CONFLICT, maintenance, ...)
 * is recorded in booking_series_skips and the walk continues.
 */
export class SeriesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bookings: BookingService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Creates a series, then materializes it straight away (up to the booking
   * horizon), so the caller sees which dates they got and which were skipped
   * without waiting for the nightly run.
   *
   * Validated like a booking: the resource is active; every occurrence has
   * the same IST shape (IST has no DST), so checking the next one checks the
   * same-day rule and min/max length for all of them; capacity is checked
   * against attendee_count. Past/horizon limits apply per occurrence at
   * materialization, as for any booking.
   */
  async create(actor: Actor, input: CreateSeriesInput): Promise<SeriesDetail> {
    const rule = parseWeeklyRule(input.rrule);
    const series = await this.uow.transaction(async (tx) => {
      await tx.resources.lockForShare(input.resourceId);
      const resource = await tx.resources.findById(input.resourceId);
      if (!resource) throw resourceNotFound();
      if (!resource.isActive) throw new DomainError("FORBIDDEN", "This resource is not accepting bookings");

      const next = nextOccurrence(rule, input.startTime, input.durationMinutes, this.now());
      if (!next) throw new DomainError("INVALID_RRULE", "This rule has no occurrences left: its UNTIL has passed");
      assertSlotLength(resource, next);
      assertCapacity(resource, input.attendeeCount);

      const created = await tx.series.insert({
        resourceId: resource.id,
        userId: actor.id,
        rrule: formatWeeklyRule(rule),
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        purpose: input.purpose,
        attendeeCount: input.attendeeCount,
      });
      await tx.writeAudit({
        actorId: actor.id,
        entityType: "booking_series",
        entityId: created.id,
        action: "series.created",
        before: null,
        after: created,
      });
      return created;
    });

    await this.materialize(series.id, actor.id);
    return this.get(series.id);
  }

  async get(id: string): Promise<SeriesDetail> {
    const series = await this.uow.read.series.findById(id);
    if (!series) throw seriesNotFound();
    const resource = await this.uow.read.resources.findById(series.resourceId);
    if (!resource) throw seriesNotFound();
    const [occurrences, skipped] = await Promise.all([
      this.uow.read.bookings.listBySeries(id),
      this.uow.read.series.listSkips(id),
    ]);
    return { series, resource, occurrences, skipped };
  }

  /**
   * Cancels the series and, in the same transaction, every occurrence that
   * hasn't started and is still cancellable (pending/approved) — each through
   * the booking state machine (BookingService.cancelWithin), with its own
   * audit row. Checked-in, completed and already-closed occurrences, and any
   * occurrence already under way, are left exactly as they are.
   * Callers must have passed `can(actor, "series:cancel", …)`.
   */
  async cancel(actor: Actor, id: string): Promise<SeriesDetail> {
    await this.uow.transaction(async (tx) => {
      await tx.series.lockById(id);
      const before = await tx.series.findById(id);
      if (!before) throw seriesNotFound();
      if (before.status === "cancelled") {
        throw new DomainError("INVALID_TRANSITION", "This series is already cancelled");
      }
      const now = this.now();
      const after = await tx.series.markCancelled(id, now);

      const cancelledBookingIds: string[] = [];
      for (const bookingId of await tx.bookings.listCancellableInSeries(id, now)) {
        try {
          await this.bookings.cancelWithin(tx, bookingId, actor);
          cancelledBookingIds.push(bookingId);
        } catch (err) {
          // Its state changed since the listing (e.g. checked in): leave it.
          // The state machine refuses before writing anything, so the
          // transaction is still sound.
          if (err instanceof DomainError && err.code === "INVALID_TRANSITION") continue;
          throw err;
        }
      }

      await tx.writeAudit({
        actorId: actor.id,
        entityType: "booking_series",
        entityId: id,
        action: "series.cancelled",
        before,
        after: { ...after, cancelledBookingIds },
      });
    });
    return this.get(id);
  }

  /**
   * Materializes one series up to its resource's booking horizon.
   * `actorId`: the user who triggered it (series creation), or null for the
   * nightly job.
   */
  async materialize(seriesId: string, actorId: string | null): Promise<MaterializeOutcome> {
    const outcome: MaterializeOutcome = { created: 0, skipped: 0, paused: false };
    const series = await this.uow.read.series.findById(seriesId);
    if (!series || series.status !== "active") return outcome;
    const resource = await this.uow.read.resources.findById(series.resourceId);
    if (!resource) return outcome;
    try {
      assertMayBook(await this.uow.read.users.findById(series.userId), resource);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return { ...outcome, paused: true };
    }

    const now = this.now();
    const cursor = series.materializedThrough;
    const after = cursor && cursor.getTime() > now.getTime() ? cursor : now;
    const due = occurrencesBetween(
      parseWeeklyRule(series.rrule),
      series.startTime,
      series.durationMinutes,
      after,
      horizonEnd(resource, now),
    );

    for (const occurrence of due) {
      try {
        await this.bookOccurrence(series, occurrence, actorId);
        outcome.created += 1;
      } catch (err) {
        if (err instanceof StaleSeries) break;
        if (!(err instanceof DomainError)) throw err;
        try {
          await this.recordSkip(series, occurrence, err, actorId);
        } catch (skipErr) {
          if (skipErr instanceof StaleSeries) break;
          throw skipErr;
        }
        outcome.skipped += 1;
      }
    }
    return outcome;
  }

  /**
   * Series materializer (§8, nightly). Every active series, one at a time;
   * one failing series is counted and the rest still run. Idempotent: the
   * cursor means a second run finds no new occurrences until time moves the
   * horizon forward.
   */
  async runMaterializer(): Promise<MaterializerResult> {
    const result: MaterializerResult = { series: 0, created: 0, skipped: 0, paused: 0, failed: 0 };
    let afterId: string | null = null;
    for (;;) {
      const ids: string[] = await this.uow.read.series.listActive(afterId, JOB_BATCH_SIZE);
      for (const id of ids) {
        result.series += 1;
        try {
          const o = await this.materialize(id, null);
          result.created += o.created;
          result.skipped += o.skipped;
          if (o.paused) result.paused += 1;
        } catch {
          result.failed += 1;
        }
      }
      if (ids.length < JOB_BATCH_SIZE) return result;
      afterId = ids[ids.length - 1] ?? null;
    }
  }

  /** Books one occurrence and advances the cursor past it, atomically. */
  private async bookOccurrence(series: BookingSeries, occ: Occurrence, actorId: string | null): Promise<void> {
    await this.uow.transaction(async (tx) => {
      await tx.series.lockById(series.id);
      assertStillDue(await tx.series.findById(series.id), occ);
      await this.bookings.insertInTx(
        tx,
        {
          resourceId: series.resourceId,
          userId: series.userId,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          purpose: series.purpose,
          attendeeCount: series.attendeeCount,
          idempotencyKey: null,
          seriesId: series.id,
        },
        actorId,
      );
      await tx.series.advanceCursor(series.id, occ.startsAt);
    });
  }

  /**
   * Records why an occurrence was not booked and advances the cursor past it.
   * Runs in its own transaction: the failed insert's transaction has already
   * rolled back.
   */
  private async recordSkip(series: BookingSeries, occ: Occurrence, reason: DomainError, actorId: string | null): Promise<void> {
    await this.uow.transaction(async (tx) => {
      await tx.series.lockById(series.id);
      const before = await tx.series.findById(series.id);
      assertStillDue(before, occ);
      const skip = await tx.series.insertSkip({
        seriesId: series.id,
        startsAt: occ.startsAt,
        endsAt: occ.endsAt,
        reason: reason.code,
        message: reason.message,
      });
      const after = await tx.series.advanceCursor(series.id, occ.startsAt);
      await tx.writeAudit({
        actorId,
        entityType: "booking_series",
        entityId: series.id,
        action: "series.occurrence_skipped",
        before,
        after: { ...after, skipped: skip },
      });
    });
  }
}

/** Under the series row lock: still active, and this occurrence not yet processed. */
function assertStillDue(series: BookingSeries | null, occ: Occurrence): asserts series is BookingSeries {
  if (!series || series.status !== "active") throw new StaleSeries();
  const cursor = series.materializedThrough;
  if (cursor && occ.startsAt.getTime() <= cursor.getTime()) throw new StaleSeries();
}
