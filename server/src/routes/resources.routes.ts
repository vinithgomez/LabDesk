import { Router } from "express";
import { z } from "zod";
import { can, defaultResourceScope, denial } from "../auth/policy.js";
import { RESOURCE_TYPES } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { isoDateTime, respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { ResourceService } from "../services/resource.service.js";
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
    ownerIds: z.array(z.uuid()).max(20).default([]),
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
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export const resourceListDto = z.array(resourceDto);

export type CreateResourceBody = z.input<typeof createResourceBody>;
export type UpdateResourceBody = z.input<typeof updateResourceBody>;
export type ListResourcesQuery = z.input<typeof listResourcesQuery>;
export type ResourceDto = z.output<typeof resourceDto>;

// ---- Router ---------------------------------------------------------------

export function resourcesRouter(auth: AuthService, resources: ResourceService): Router {
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

  router.post("/", async (req, res) => {
    const actor = actorOf(req);
    const { departmentId, ownerIds, ...fields } = createResourceBody.parse(req.body);

    // A resource that doesn't exist yet has no owners, so only admins pass.
    const subject = { departmentId, ownerIds: [] };
    if (!can(actor, "resource:manage", subject)) throw denial(actor, "resource:manage", subject);

    respond(res, 201, resourceDto, await resources.create({ departmentId, fields, ownerIds }));
  });

  router.patch("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    const patch = updateResourceBody.parse(req.body);

    const resource = await resources.get(id);
    if (!can(actor, "resource:manage", resource)) throw denial(actor, "resource:manage", resource);

    respond(res, 200, resourceDto, await resources.update(id, patch));
  });

  router.delete("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);

    const resource = await resources.get(id);
    if (!can(actor, "resource:manage", resource)) throw denial(actor, "resource:manage", resource);

    respond(res, 200, resourceDto, await resources.deactivate(id));
  });

  return router;
}
