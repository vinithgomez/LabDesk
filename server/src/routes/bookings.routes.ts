import { Router } from "express";
import { z } from "zod";
import { can, denial } from "../auth/policy.js";
import { BOOKING_STATUSES } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { isoDateTime, respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { BookingService } from "../services/booking.service.js";
import type { ResourceService } from "../services/resource.service.js";

// ---- Request schemas ------------------------------------------------------

/** An instant with an explicit offset; stored and returned in UTC. */
const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

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
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export type CreateBookingBody = z.input<typeof createBookingBody>;
export type BookingDto = z.output<typeof bookingDto>;

const toDto = <B extends { startsAt: Date; endsAt: Date }>({ startsAt, endsAt, ...rest }: B) => ({
  ...rest,
  start: startsAt,
  end: endsAt,
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

    const booking = await bookings.create(actor, {
      resourceId: resource.id,
      startsAt: body.start,
      endsAt: body.end,
      purpose: body.purpose,
      attendeeCount: body.attendeeCount,
      idempotencyKey,
    });
    respond(res, 201, bookingDto, toDto(booking));
  });

  return router;
}
