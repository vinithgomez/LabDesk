import { Router } from "express";
import { z } from "zod";
import { can, denial } from "../auth/policy.js";
import { WAITLIST_STATUSES, type WaitlistEntry } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { isoDateTime, respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { ResourceService } from "../services/resource.service.js";
import type { WaitlistService } from "../services/waitlist.service.js";
import { instant } from "./bookings.routes.js";
import { idParams } from "./schemas.js";

// ---- Request schemas ------------------------------------------------------

export const joinWaitlistBody = z.strictObject({
  resourceId: z.uuid(),
  desiredPeriod: z
    .strictObject({ start: instant, end: instant })
    .refine((p) => p.end.getTime() > p.start.getTime(), { message: "end must be after start", path: ["end"] }),
  purpose: z.string().trim().max(500).default(""),
  attendeeCount: z.number().int().min(1).max(10_000).default(1),
});

export const listWaitlistQuery = z.object({
  /** Comma-separated, e.g. status=waiting,promoted */
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(WAITLIST_STATUSES)).optional()),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

// ---- Response schemas -----------------------------------------------------

export const waitlistEntryDto = z.object({
  id: z.string(),
  resourceId: z.string(),
  userId: z.string(),
  desiredPeriod: z.object({ start: isoDateTime, end: isoDateTime }),
  purpose: z.string(),
  attendeeCount: z.number(),
  status: z.enum(WAITLIST_STATUSES),
  /** The booking a promoted entry became. */
  bookingId: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export const waitlistEntryListDto = z.array(waitlistEntryDto);

export type JoinWaitlistBody = z.input<typeof joinWaitlistBody>;
export type ListWaitlistQuery = z.input<typeof listWaitlistQuery>;
export type WaitlistEntryDto = z.output<typeof waitlistEntryDto>;

const toEntryDto = ({ startsAt, endsAt, ...rest }: WaitlistEntry) => ({
  ...rest,
  desiredPeriod: { start: startsAt, end: endsAt },
});

// ---- Router ---------------------------------------------------------------

export function waitlistRouter(auth: AuthService, waitlist: WaitlistService, resources: ResourceService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  /** Join the waitlist for a slot someone currently holds. */
  router.post("/", async (req, res) => {
    const actor = actorOf(req);
    const body = joinWaitlistBody.parse(req.body);

    const resource = await resources.get(body.resourceId);
    if (!can(actor, "waitlist:create", resource)) throw denial(actor, "waitlist:create", resource);

    const entry = await waitlist.join(actor, {
      resourceId: resource.id,
      startsAt: body.desiredPeriod.start,
      endsAt: body.desiredPeriod.end,
      purpose: body.purpose,
      attendeeCount: body.attendeeCount,
    });
    respond(res, 201, waitlistEntryDto, toEntryDto(entry));
  });

  /** The caller's own entries, newest first. Nobody lists anyone else's. */
  router.get("/", async (req, res) => {
    const actor = actorOf(req);
    const query = listWaitlistQuery.parse(req.query);
    const entries = await waitlist.listMine(actor, query.status, query.limit);
    respond(res, 200, waitlistEntryListDto, entries.map(toEntryDto));
  });

  /** Leave the waitlist (a 'waiting' entry only). */
  router.delete("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);

    const subject = { userId: (await waitlist.get(id)).userId };
    if (!can(actor, "waitlist:cancel", subject)) throw denial(actor, "waitlist:cancel", subject);

    respond(res, 200, waitlistEntryDto, toEntryDto(await waitlist.cancel(actor, id)));
  });

  return router;
}
