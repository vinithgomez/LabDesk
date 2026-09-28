import { Router } from "express";
import { z } from "zod";
import { can, denial, type IncidentSubject } from "../auth/policy.js";
import { INCIDENT_SEVERITIES } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { isoDateTime, respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { IncidentService, IncidentView } from "../services/incident.service.js";
import type { ResourceService } from "../services/resource.service.js";
import { idParams } from "./schemas.js";

// ---- Request schemas ------------------------------------------------------

export const reportIncidentBody = z.strictObject({
  resourceId: z.uuid(),
  /** The booking during which it happened or was found, if any. */
  bookingId: z.uuid().nullable().default(null),
  severity: z.enum(INCIDENT_SEVERITIES),
  description: z.string().trim().min(1).max(2000),
});

export const resolveIncidentBody = z.strictObject({ resolution: z.string().trim().max(2000).default("") }).optional();

export const listIncidentsQuery = z.object({
  /** A resource's incidents (its owners and admins); omitted: the ones you reported. */
  resourceId: z.uuid().optional(),
  state: z.enum(["open", "resolved", "all"]).default("open"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

// ---- Response schemas -----------------------------------------------------

export const incidentDto = z.object({
  id: z.string(),
  resourceId: z.string(),
  bookingId: z.string().nullable(),
  reportedBy: z.string(),
  severity: z.enum(INCIDENT_SEVERITIES),
  description: z.string(),
  createdAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
  resolvedBy: z.string().nullable(),
  resolution: z.string(),
});
export const incidentListDto = z.array(incidentDto);

export type ReportIncidentBody = z.input<typeof reportIncidentBody>;
export type IncidentDto = z.output<typeof incidentDto>;

const subjectOf = ({ incident, resource }: IncidentView): IncidentSubject => ({
  reportedBy: incident.reportedBy,
  resource: { id: resource.id, departmentId: resource.departmentId, ownerIds: resource.ownerIds },
});

// ---- Router ---------------------------------------------------------------

export function incidentsRouter(auth: AuthService, incidents: IncidentService, resources: ResourceService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.post("/", async (req, res) => {
    const actor = actorOf(req);
    const body = reportIncidentBody.parse(req.body);

    const context = await incidents.reportContext(actor, body.resourceId, body.bookingId);
    const subject = {
      resource: { id: context.resource.id, departmentId: context.resource.departmentId, ownerIds: context.resource.ownerIds },
      reporterHadBooking: context.reporterHadBooking,
      bookingUserId: context.bookingUserId,
    };
    if (!can(actor, "incident:report", subject)) throw denial(actor, "incident:report", subject);

    respond(res, 201, incidentDto, await incidents.report(actor, body));
  });

  router.get("/", async (req, res) => {
    const actor = actorOf(req);
    const query = listIncidentsQuery.parse(req.query);
    const filter = { state: query.state, limit: query.limit };

    if (!query.resourceId) {
      respond(res, 200, incidentListDto, await incidents.listMine(actor, filter));
      return;
    }
    const resource = await resources.get(query.resourceId);
    if (!can(actor, "resource:manage", resource)) throw denial(actor, "resource:manage", resource);
    respond(res, 200, incidentListDto, await incidents.listForResource(resource.id, filter));
  });

  router.get("/:id", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    const view = await incidents.get(id);
    const subject = subjectOf(view);
    if (!can(actor, "incident:view", subject)) throw denial(actor, "incident:view", subject);
    respond(res, 200, incidentDto, view.incident);
  });

  router.patch("/:id/resolve", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    const { resolution } = resolveIncidentBody.parse(req.body) ?? { resolution: "" };

    const subject = subjectOf(await incidents.get(id));
    if (!can(actor, "incident:resolve", subject)) throw denial(actor, "incident:resolve", subject);

    respond(res, 200, incidentDto, await incidents.resolve(actor, id, resolution));
  });

  return router;
}
