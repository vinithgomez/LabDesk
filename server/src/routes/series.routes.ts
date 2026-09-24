import { Router } from "express";
import { z } from "zod";
import { can, denial, type SeriesSubject } from "../auth/policy.js";
import { BOOKING_STATUSES, SERIES_STATUSES } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { isoDateTime, respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { ResourceService } from "../services/resource.service.js";
import type { SeriesDetail, SeriesService } from "../services/series.service.js";
import { idParams } from "./schemas.js";

// ---- Request schemas ------------------------------------------------------

export const createSeriesBody = z.strictObject({
  resourceId: z.uuid(),
  /** RFC 5545 subset: FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231 (validated by the service). */
  rrule: z.string().trim().min(1).max(200),
  /** IST wall-clock start of every occurrence. */
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "startTime must be HH:MM (24-hour, IST)"),
  durationMinutes: z.number().int().min(1).max(24 * 60),
  purpose: z.string().trim().max(500).default(""),
  attendeeCount: z.number().int().min(1).max(10_000).default(1),
});

// DELETE takes no body; anything sent is rejected like any unknown field.
export const cancelSeriesBody = z.strictObject({}).optional();

// ---- Response schemas -----------------------------------------------------

/**
 * A series with its materialized occurrences (ordinary bookings; each can be
 * cancelled on its own via POST /api/bookings/:id/cancel) and the occurrences
 * the materializer skipped, with the reason code and message.
 */
export const seriesDto = z.object({
  id: z.string(),
  resourceId: z.string(),
  userId: z.string(),
  rrule: z.string(),
  startTime: z.string(),
  durationMinutes: z.number(),
  purpose: z.string(),
  attendeeCount: z.number(),
  status: z.enum(SERIES_STATUSES),
  /** Occurrences starting at or before this have been booked or skipped. */
  materializedThrough: isoDateTime.nullable(),
  cancelledAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  occurrences: z.array(
    z.object({ bookingId: z.string(), start: isoDateTime, end: isoDateTime, status: z.enum(BOOKING_STATUSES) }),
  ),
  skipped: z.array(
    z.object({ start: isoDateTime, end: isoDateTime, reason: z.string(), message: z.string(), recordedAt: isoDateTime }),
  ),
});

export type CreateSeriesBody = z.input<typeof createSeriesBody>;
export type SeriesDto = z.output<typeof seriesDto>;

const toSeriesDto = ({ series, occurrences, skipped }: SeriesDetail) => ({
  ...series,
  occurrences: occurrences.map((b) => ({ bookingId: b.id, start: b.startsAt, end: b.endsAt, status: b.status })),
  skipped: skipped.map((k) => ({
    start: k.startsAt,
    end: k.endsAt,
    reason: k.reason,
    message: k.message,
    recordedAt: k.createdAt,
  })),
});

const subjectOf = ({ series, resource }: SeriesDetail): SeriesSubject => ({
  id: series.id,
  userId: series.userId,
  resource: { id: resource.id, departmentId: resource.departmentId, ownerIds: resource.ownerIds },
});

// ---- Router ---------------------------------------------------------------

export function seriesRouter(auth: AuthService, series: SeriesService, resources: ResourceService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  /** Creates a series and books its occurrences up to the booking horizon. */
  router.post("/", async (req, res) => {
    const actor = actorOf(req);
    const body = createSeriesBody.parse(req.body);

    const resource = await resources.get(body.resourceId);
    if (!can(actor, "series:create", resource)) throw denial(actor, "series:create", resource);

    respond(res, 201, seriesDto, toSeriesDto(await series.create(actor, { ...body, resourceId: resource.id })));
  });

  router.get("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);

    const detail = await series.get(id);
    const subject = subjectOf(detail);
    if (!can(actor, "series:view", subject)) throw denial(actor, "series:view", subject);

    respond(res, 200, seriesDto, toSeriesDto(detail));
  });

  /** Cancels the series and its future, still-cancellable occurrences. */
  router.delete("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    cancelSeriesBody.parse(req.body);

    const subject = subjectOf(await series.get(id));
    if (!can(actor, "series:cancel", subject)) throw denial(actor, "series:cancel", subject);

    respond(res, 200, seriesDto, toSeriesDto(await series.cancel(actor, id)));
  });

  return router;
}
