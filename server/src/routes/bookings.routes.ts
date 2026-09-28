import { Router } from "express";
import { z } from "zod";
import {
  approvalInboxScope,
  bookingListScope,
  can,
  denial,
  type ApprovalSubject,
  type BookingSubject,
} from "../auth/policy.js";
import { APPROVAL_DECISIONS, BOOKING_STATUSES } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { isoDateTime, respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { ApprovalState, BookingService, BookingView } from "../services/booking.service.js";
import type { ResourceService } from "../services/resource.service.js";
import { idParams } from "./schemas.js";

// ---- Request schemas ------------------------------------------------------

/** An instant with an explicit offset; stored and returned in UTC. */
export const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const idempotencyKeyHeader = z
  .string({ error: "Idempotency-Key header is required" })
  .min(1)
  .max(255)
  .regex(/^[\x21-\x7E]+$/, "Idempotency-Key must be printable ASCII without spaces");

export const createBookingBody = z
  .strictObject({
    resourceId: z.uuid(),
    start: instant,
    end: instant,
    purpose: z.string().trim().max(500).default(""),
    attendeeCount: z.number().int().min(1).max(10_000).default(1),
  })
  .refine((b) => b.end.getTime() > b.start.getTime(), { message: "end must be after start", path: ["end"] });

export const listBookingsQuery = z
  .object({
    mine: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /** Comma-separated, e.g. status=pending,approved */
    status: z
      .string()
      .optional()
      .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined))
      .pipe(z.array(z.enum(BOOKING_STATUSES)).optional()),
    resourceId: z.uuid().optional(),
    from: instant.optional(),
    to: instant.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine((q) => !q.from || !q.to || q.to.getTime() > q.from.getTime(), {
    message: "to must be after from",
    path: ["to"],
  });

// Cancel takes no body; anything sent is rejected like any unknown field.
export const cancelBookingBody = z.strictObject({}).optional();

export const inboxQuery = z.object({
  /** true: only items the actor can decide right now. */
  actionable: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Approve / reject: an optional comment recorded with the decision. */
export const decisionBody = z.strictObject({ comment: z.string().trim().max(1000).default("") }).optional();

// ---- Response schemas -----------------------------------------------------

export const bookingDto = z.object({
  id: z.string(),
  resourceId: z.string(),
  userId: z.string(),
  start: isoDateTime,
  end: isoDateTime,
  status: z.enum(BOOKING_STATUSES),
  purpose: z.string(),
  attendeeCount: z.number(),
  seriesId: z.string().nullable(),
  /** Set when a maintenance window cancelled this booking; see `cancellation` on its detail. */
  cancelledByMaintenanceId: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export const bookingListDto = z.array(bookingDto);

export const approvalDto = z.object({
  level: z.number(),
  approverId: z.string(),
  decision: z.enum(APPROVAL_DECISIONS),
  comment: z.string(),
  decidedAt: isoDateTime,
});

/**
 * Why the system cancelled a booking (currently only a maintenance window
 * created over it, §2c). Times are UTC; the UI renders them locally.
 */
export const cancellationDto = z.object({
  kind: z.literal("maintenance"),
  message: z.string(),
  maintenance: z.object({ id: z.string(), start: isoDateTime, end: isoDateTime, reason: z.string() }),
});

/** A booking with its approval trail and the level awaiting a decision (null if none). */
export const bookingWithApprovalsDto = bookingDto.extend({
  approvals: z.array(approvalDto),
  awaitingLevel: z.number().nullable(),
  cancellation: cancellationDto.nullable(),
});

/**
 * An approvals-inbox entry. `stalled`: partially approved and the awaited
 * level has not acted for 24h. `lapsed`: the start has passed, so the only
 * remaining decision is reject. `canDecide`: booking:approve for this actor.
 */
export const inboxItemDto = bookingWithApprovalsDto.extend({
  resource: z.object({ id: z.string(), name: z.string() }),
  awaitingSince: isoDateTime,
  stalled: z.boolean(),
  lapsed: z.boolean(),
  canDecide: z.boolean(),
});
export const inboxDto = z.array(inboxItemDto);

export type CreateBookingBody = z.input<typeof createBookingBody>;
export type InboxQuery = z.input<typeof inboxQuery>;
export type InboxItemDto = z.output<typeof inboxItemDto>;
export type ListBookingsQuery = z.input<typeof listBookingsQuery>;
export type BookingDto = z.output<typeof bookingDto>;
export type DecisionBody = z.input<typeof decisionBody>;
export type BookingWithApprovalsDto = z.output<typeof bookingWithApprovalsDto>;

export const IDEMPOTENT_REPLAY = "IDEMPOTENT_REPLAY";

export const toBookingDto = <B extends { startsAt: Date; endsAt: Date }>({ startsAt, endsAt, ...rest }: B) => ({
  ...rest,
  start: startsAt,
  end: endsAt,
});

const subjectOf = ({ booking, resource }: BookingView): BookingSubject => ({
  id: booking.id,
  userId: booking.userId,
  status: booking.status,
  resource: { id: resource.id, departmentId: resource.departmentId, ownerIds: resource.ownerIds },
});

export const approvalSubjectOf = (state: ApprovalState): ApprovalSubject => {
  const base = subjectOf(state);
  return {
    ...base,
    resource: { ...base.resource, owners: state.resource.owners },
    nextLevel: state.progress.nextLevel,
    deciderIds: state.progress.deciderIds,
  };
};

const withApprovals = (state: ApprovalState) => ({
  ...toBookingDto(state.booking),
  approvals: state.approvals,
  awaitingLevel: state.progress.nextLevel,
  cancellation: state.cancellation,
});

// ---- Router ---------------------------------------------------------------

export function bookingsRouter(auth: AuthService, bookings: BookingService, resources: ResourceService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.post("/", async (req, res) => {
    const actor = actorOf(req);
    const idempotencyKey = idempotencyKeyHeader.parse(req.get("Idempotency-Key"));
    const body = createBookingBody.parse(req.body);

    const resource = await resources.get(body.resourceId);
    if (!can(actor, "booking:create", resource)) throw denial(actor, "booking:create", resource);

    const { booking, replayed } = await bookings.create(actor, {
      resourceId: resource.id,
      startsAt: body.start,
      endsAt: body.end,
      purpose: body.purpose,
      attendeeCount: body.attendeeCount,
      idempotencyKey,
    });
    if (replayed) {
      res.set("Idempotent-Replayed", "true");
      respond(res, 200, bookingDto, toBookingDto(booking), { code: IDEMPOTENT_REPLAY });
      return;
    }
    respond(res, 201, bookingDto, toBookingDto(booking));
  });

  router.get("/", async (req, res) => {
    const actor = actorOf(req);
    const query = listBookingsQuery.parse(req.query);

    const views = await bookings.list(bookingListScope(actor, { mine: query.mine }), {
      statuses: query.status,
      resourceId: query.resourceId,
      from: query.from,
      to: query.to,
      limit: query.limit,
    });
    // The scope already restricts the query; every row is still checked.
    const visible = views.filter((v) => can(actor, "booking:view", subjectOf(v)));
    respond(res, 200, bookingListDto, visible.map((v) => toBookingDto(v.booking)));
  });

  // Registered before "/:id" so "pending" is never parsed as a booking id.
  router.get("/pending", async (req, res) => {
    const actor = actorOf(req);
    const query = inboxQuery.parse(req.query);

    const items = await bookings.inbox(approvalInboxScope(actor), query.limit);
    const shown = items
      .filter((item) => can(actor, "booking:view", subjectOf(item)))
      .map((item) => ({ item, canDecide: can(actor, "booking:approve", approvalSubjectOf(item)) }))
      .filter(({ canDecide }) => !query.actionable || canDecide);

    respond(
      res,
      200,
      inboxDto,
      shown.map(({ item, canDecide }) => ({
        ...withApprovals(item),
        resource: { id: item.resource.id, name: item.resource.name },
        awaitingSince: item.awaitingSince,
        stalled: item.stalled,
        lapsed: item.lapsed,
        canDecide,
      })),
    );
  });

  router.get("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);

    const state = await bookings.getApprovalState(id);
    const subject = subjectOf(state);
    if (!can(actor, "booking:view", subject)) throw denial(actor, "booking:view", subject);

    respond(res, 200, bookingWithApprovalsDto, withApprovals(state));
  });

  router.post("/:id/cancel", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    cancelBookingBody.parse(req.body);

    const subject = subjectOf(await bookings.get(id));
    if (!can(actor, "booking:cancel", subject)) throw denial(actor, "booking:cancel", subject);

    respond(res, 200, bookingDto, toBookingDto(await bookings.transitionBooking(id, "cancel", actor)));
  });

  // Approve and reject are both booking:approve decisions. The route
  // authorizes against the level awaiting a decision right now and passes
  // that level on; transitionBooking re-checks it under a row lock.
  for (const action of ["approve", "reject"] as const) {
    router.post(`/:id/${action}`, async (req, res) => {
      const actor = actorOf(req);
      const { id } = idParams.parse(req.params);
      const { comment } = decisionBody.parse(req.body) ?? { comment: "" };

      const state = await bookings.getApprovalState(id);
      const subject = approvalSubjectOf(state);
      if (!can(actor, "booking:approve", subject)) throw denial(actor, "booking:approve", subject);

      await bookings.transitionBooking(id, action, actor, { level: state.progress.nextLevel, comment });
      respond(res, 200, bookingWithApprovalsDto, withApprovals(await bookings.getApprovalState(id)));
    });
  }

  return router;
}
