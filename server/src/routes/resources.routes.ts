import { Router } from "express";
import { z } from "zod";
import { can, defaultResourceScope, denial } from "../auth/policy.js";
import { BOOKING_STATUSES, RESOURCE_TYPES } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { isoDateTime, respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { BookingService } from "../services/booking.service.js";
import type { ResourceService } from "../services/resource.service.js";
import { instant } from "./bookings.routes.js";
import { idParams } from "./schemas.js";

// ---- Request schemas ------------------------------------------------------

const resourceFields = {
  name: z.string().trim().min(1).max(120),
  type: z.enum(RESOURCE_TYPES),
  location: z.string().trim().min(1).max(120),
  capacity: z.number().int().min(0).max(10_000),
  description: z.string().trim().max(2000),
  requiresApproval: z.boolean(),
  approvalLevels: z.union([z.literal(1), z.literal(2)]),
  minSlotMinutes: z.number().int().min(1).max(1440),
  // Same-day bookings only (CLAUDE.md §2b), so a slot can never exceed a day.
  maxSlotMinutes: z.number().int().min(1).max(1440),
  bookingHorizonDays: z.number().int().min(1).max(365),
  isActive: z.boolean(),
};

/** An owner and the approval level (1 or 2) they decide at. */
const ownerInput = z.strictObject({
  userId: z.uuid(),
  approvalLevel: z.union([z.literal(1), z.literal(2)]).default(1),
});

/** Replaces the owner set wholesale. An empty list is allowed only if the resource doesn't require approval. */
export const replaceOwnersBody = z.strictObject({ owners: z.array(ownerInput).max(20) });

export const createResourceBody = z
  .strictObject({
    departmentId: z.uuid(),
    name: resourceFields.name,
    type: resourceFields.type,
    location: resourceFields.location,
    capacity: resourceFields.capacity,
    description: resourceFields.description.default(""),
    requiresApproval: resourceFields.requiresApproval.default(false),
    approvalLevels: resourceFields.approvalLevels.default(1),
    minSlotMinutes: resourceFields.minSlotMinutes.default(30),
    maxSlotMinutes: resourceFields.maxSlotMinutes.default(180),
    bookingHorizonDays: resourceFields.bookingHorizonDays.default(14),
    isActive: resourceFields.isActive.default(true),
    owners: z.array(ownerInput).max(20).default([]),
  })
  .refine((b) => b.minSlotMinutes <= b.maxSlotMinutes, {
    message: "minSlotMinutes must not exceed maxSlotMinutes",
    path: ["minSlotMinutes"],
  });

// Department and ownership are not editable via PATCH.
export const updateResourceBody = z
  .strictObject(resourceFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field to update" });

export const listResourcesQuery = z.object({
  type: z.enum(RESOURCE_TYPES).optional(),
  q: z.string().trim().max(100).optional(),
  departmentId: z.uuid().optional(),
  active: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

const MAX_AVAILABILITY_WINDOW_MS = 31 * 86_400_000;

export const availabilityQuery = z
  .object({ from: instant, to: instant })
  .refine((q) => q.to.getTime() > q.from.getTime(), { message: "to must be after from", path: ["to"] })
  .refine((q) => q.to.getTime() - q.from.getTime() <= MAX_AVAILABILITY_WINDOW_MS, {
    message: "The window may span at most 31 days",
    path: ["to"],
  });

// ---- Response schemas -----------------------------------------------------

export const resourceDto = z.object({
  id: z.string(),
  departmentId: z.string(),
  name: z.string(),
  type: z.enum(RESOURCE_TYPES),
  location: z.string(),
  capacity: z.number(),
  description: z.string(),
  requiresApproval: z.boolean(),
  approvalLevels: z.number(),
  minSlotMinutes: z.number(),
  maxSlotMinutes: z.number(),
  bookingHorizonDays: z.number(),
  isActive: z.boolean(),
  ownerIds: z.array(z.string()),
  owners: z.array(z.object({ userId: z.string(), approvalLevel: z.number() })),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export const resourceListDto = z.array(resourceDto);

/**
 * Busy intervals only — no booker identity is exposed. Bookings carry their
 * status so a calendar can shade pending (tentative) holds differently.
 */
export const availabilityDto = z.object({
  resourceId: z.string(),
  from: isoDateTime,
  to: isoDateTime,
  busy: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("booking"), start: isoDateTime, end: isoDateTime, status: z.enum(BOOKING_STATUSES) }),
      z.object({ kind: z.literal("maintenance"), start: isoDateTime, end: isoDateTime }),
    ]),
  ),
});

export type CreateResourceBody = z.input<typeof createResourceBody>;
export type ReplaceOwnersBody = z.input<typeof replaceOwnersBody>;
export type AvailabilityQuery = z.input<typeof availabilityQuery>;
export type AvailabilityDto = z.output<typeof availabilityDto>;
export type UpdateResourceBody = z.input<typeof updateResourceBody>;
export type ListResourcesQuery = z.input<typeof listResourcesQuery>;
export type ResourceDto = z.output<typeof resourceDto>;

// ---- Router ---------------------------------------------------------------

export function resourcesRouter(auth: AuthService, resources: ResourceService, bookings: BookingService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get("/", async (req, res) => {
    const actor = actorOf(req);
    const query = listResourcesQuery.parse(req.query);

    const scope = query.departmentId ? { departmentId: query.departmentId } : defaultResourceScope(actor);
    if (!can(actor, "resource:view", scope)) throw denial(actor, "resource:view", scope);

    const list = await resources.list({
      departmentId: scope.departmentId,
      type: query.type,
      q: query.q,
      isActive: query.active,
    });
    respond(res, 200, resourceListDto, list);
  });

  router.get("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);

    const resource = await resources.get(id);
    if (!can(actor, "resource:view", resource)) throw denial(actor, "resource:view", resource);

    respond(res, 200, resourceDto, resource);
  });

  router.get("/:id/availability", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    const { from, to } = availabilityQuery.parse(req.query);

    const resource = await resources.get(id);
    if (!can(actor, "resource:view", resource)) throw denial(actor, "resource:view", resource);

    const { held, maintenance } = await bookings.availability(resource.id, from, to);
    const busy = [
      ...held.map((b) => ({ kind: "booking" as const, start: b.startsAt, end: b.endsAt, status: b.status })),
      ...maintenance.map((m) => ({ kind: "maintenance" as const, start: m.startsAt, end: m.endsAt })),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());
    respond(res, 200, availabilityDto, { resourceId: resource.id, from, to, busy });
  });

  router.post("/", async (req, res) => {
    const actor = actorOf(req);
    const { departmentId, owners, ...fields } = createResourceBody.parse(req.body);

    // A resource that doesn't exist yet has no owners, so only admins pass.
    const subject = { departmentId, ownerIds: [] };
    if (!can(actor, "resource:manage", subject)) throw denial(actor, "resource:manage", subject);

    respond(res, 201, resourceDto, await resources.create(actor, { departmentId, fields, owners }));
  });

  router.patch("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    const patch = updateResourceBody.parse(req.body);

    const resource = await resources.get(id);
    if (!can(actor, "resource:manage", resource)) throw denial(actor, "resource:manage", resource);

    respond(res, 200, resourceDto, await resources.update(actor, id, patch));
  });

  router.patch("/:id/owners", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    const { owners } = replaceOwnersBody.parse(req.body);

    const resource = await resources.get(id);
    if (!can(actor, "resource:manage_owners", resource)) throw denial(actor, "resource:manage_owners", resource);

    respond(res, 200, resourceDto, await resources.replaceOwners(actor, id, owners));
  });

  router.delete("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);

    const resource = await resources.get(id);
    if (!can(actor, "resource:manage", resource)) throw denial(actor, "resource:manage", resource);

    respond(res, 200, resourceDto, await resources.deactivate(actor, id));
  });

  return router;
}
