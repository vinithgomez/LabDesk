import { Router } from "express";
import { z } from "zod";
import { can, denial, type ResourceManageSubject } from "../auth/policy.js";
import type { MaintenanceWindow, Resource } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { isoDateTime, respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { MaintenanceService } from "../services/maintenance.service.js";
import type { ResourceService } from "../services/resource.service.js";
import { instant } from "./bookings.routes.js";
import { idParams } from "./schemas.js";

// ---- Request schemas ------------------------------------------------------

export const createMaintenanceBody = z
  .strictObject({
    resourceId: z.uuid(),
    start: instant,
    end: instant,
    /** Shown to bookers whose bookings it cancels. */
    reason: z.string().trim().min(1).max(500),
  })
  .refine((b) => b.end.getTime() > b.start.getTime(), { message: "end must be after start", path: ["end"] });

export const listMaintenanceQuery = z.object({ resourceId: z.uuid() });

// DELETE takes no body.
export const removeMaintenanceBody = z.strictObject({}).optional();

// ---- Response schemas -----------------------------------------------------

export const maintenanceWindowDto = z.object({
  id: z.string(),
  resourceId: z.string(),
  start: isoDateTime,
  end: isoDateTime,
  reason: z.string(),
  createdBy: z.string(),
  createdAt: isoDateTime,
  removedAt: isoDateTime.nullable(),
  removedBy: z.string().nullable(),
});

/** The new window, and the bookings creating it cancelled. */
export const maintenanceCreatedDto = maintenanceWindowDto.extend({ cancelledBookingIds: z.array(z.string()) });

export type CreateMaintenanceBody = z.input<typeof createMaintenanceBody>;
export type MaintenanceWindowDto = z.output<typeof maintenanceWindowDto>;

const toWindowDto = ({ startsAt, endsAt, ...rest }: MaintenanceWindow) => ({ ...rest, start: startsAt, end: endsAt });

const manageSubject = (r: Resource): ResourceManageSubject => ({
  id: r.id,
  departmentId: r.departmentId,
  ownerIds: r.ownerIds,
});

// ---- Router ---------------------------------------------------------------

export function maintenanceRouter(auth: AuthService, maintenance: MaintenanceService, resources: ResourceService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  /** Creates a window and cancels every booking holding a slot it overlaps (§2c). */
  router.post("/", async (req, res) => {
    const actor = actorOf(req);
    const body = createMaintenanceBody.parse(req.body);

    const subject = manageSubject(await resources.get(body.resourceId));
    if (!can(actor, "maintenance:create", subject)) throw denial(actor, "maintenance:create", subject);

    const { window, cancelled } = await maintenance.create(actor, {
      resourceId: body.resourceId,
      startsAt: body.start,
      endsAt: body.end,
      reason: body.reason,
    });
    respond(res, 201, maintenanceCreatedDto, { ...toWindowDto(window), cancelledBookingIds: cancelled.map((b) => b.id) });
  });

  /** A resource's upcoming windows: visible to anyone who can see the resource. */
  router.get("/", async (req, res) => {
    const actor = actorOf(req);
    const { resourceId } = listMaintenanceQuery.parse(req.query);
    const resource = await resources.get(resourceId);
    if (!can(actor, "resource:view", resource)) throw denial(actor, "resource:view", resource);
    respond(res, 200, z.array(maintenanceWindowDto), (await maintenance.listUpcoming(resource.id)).map(toWindowDto));
  });

  /** Removes (soft-deletes) a window. Bookings it cancelled stay cancelled. */
  router.delete("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    removeMaintenanceBody.parse(req.body);

    const { resource } = await maintenance.get(id);
    const subject = manageSubject(resource);
    if (!can(actor, "maintenance:remove", subject)) throw denial(actor, "maintenance:remove", subject);

    respond(res, 200, maintenanceWindowDto, toWindowDto(await maintenance.remove(actor, id)));
  });

  return router;
}
