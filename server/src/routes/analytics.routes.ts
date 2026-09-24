import { Router, type Request } from "express";
import { z } from "zod";
import { can, defaultAnalyticsScope, denial, type AnalyticsSubject } from "../auth/policy.js";
import { resourceNotFound } from "../domain/errors.js";
import type { Actor } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { isoDateTime, respond } from "../http/respond.js";
import type { AnalyticsScope, AnalyticsService } from "../services/analytics.service.js";
import type { AuthService } from "../services/auth.service.js";
import type { ResourceService } from "../services/resource.service.js";
import { instant } from "./bookings.routes.js";

// ---- Request schemas ------------------------------------------------------

/**
 * Every analytics endpoint takes the same query. Window defaults to the last
 * 4 weeks and is clipped to now. `departmentId` defaults to the caller's own
 * department; only an admin may name another, or `all`. `resourceId`
 * narrows to one resource (and implies its department).
 */
export const analyticsQuery = z.object({
  from: instant.optional(),
  to: instant.optional(),
  departmentId: z.union([z.literal("all"), z.uuid()]).optional(),
  resourceId: z.uuid().optional(),
});

// ---- Response schemas -----------------------------------------------------

const windowDto = z.object({ from: isoDateTime, to: isoDateTime });
const scopeDto = z.object({ departmentId: z.string().nullable(), resourceId: z.string().nullable() });

const utilizationMeasures = {
  /** Business-hours minutes in the window (per-resource hours and days). */
  availableMinutes: z.number(),
  /** Minutes held by bookings other than cancelled/rejected, clipped to the window. */
  bookedMinutes: z.number(),
  /** Checked-in minutes of sessions that have ended, clipped to the window (in-hours + off-hours). */
  actualMinutes: z.number(),
  /** Checked-in minutes within business hours on business days: the utilization numerator. */
  inHoursMinutes: z.number(),
  /** Checked-in minutes outside business hours or on non-business days; not in utilization. */
  offHoursMinutes: z.number(),
  /** The part of actualMinutes from auto-completed sessions (closed at the booked end). */
  autoCompletedMinutes: z.number(),
  bookings: z.number(),
  sessions: z.number(),
  /** inHoursMinutes / availableMinutes (at most 1); null when there were no open hours. */
  utilization: z.number().nullable(),
};

export const utilizationDto = z.object({
  window: windowDto,
  scope: scopeDto,
  totals: z.object(utilizationMeasures),
  resources: z.array(
    z.object({ resourceId: z.string(), name: z.string(), departmentId: z.string(), isActive: z.boolean(), ...utilizationMeasures }),
  ),
});

const outcomeCounts = {
  noShows: z.number(),
  /** completed + checked_in */
  attended: z.number(),
  /** noShows + attended: rejected, expired, cancelled and undecided bookings are not outcomes. */
  outcomes: z.number(),
  rate: z.number().nullable(),
};

export const noShowsDto = z.object({
  window: windowDto,
  scope: scopeDto,
  overall: z.object(outcomeCounts),
  byUser: z.array(z.object({ userId: z.string(), fullName: z.string(), rollNo: z.string().nullable(), ...outcomeCounts })),
  byResource: z.array(z.object({ resourceId: z.string(), name: z.string(), ...outcomeCounts })),
});

export const heatmapDto = z.object({
  window: windowDto,
  scope: scopeDto,
  /** dow and hour are wall-clock in this zone; dow 0 = Sunday. */
  timezone: z.literal("Asia/Kolkata"),
  cells: z.array(z.object({ dow: z.number(), hour: z.number(), bookedMinutes: z.number(), bookings: z.number() })),
});

export const idleRankingDto = z.object({
  window: windowDto,
  scope: scopeDto,
  minimumDays: z.number(),
  ranked: z.array(
    z.object({
      rank: z.number(),
      resourceId: z.string(),
      name: z.string(),
      utilization: z.number().nullable(),
      availableMinutes: z.number(),
      bookedMinutes: z.number(),
      actualMinutes: z.number(),
      inHoursMinutes: z.number(),
      offHoursMinutes: z.number(),
      observedDays: z.number(),
    }),
  ),
  /** Resources left out of the ranking, and why. */
  excluded: z.array(
    z.object({
      resourceId: z.string(),
      name: z.string(),
      reason: z.enum(["INACTIVE", "INSUFFICIENT_DATA", "NO_AVAILABLE_HOURS"]),
      observedDays: z.number(),
      message: z.string(),
    }),
  ),
});

export type AnalyticsQuery = z.input<typeof analyticsQuery>;
export type UtilizationDto = z.output<typeof utilizationDto>;
export type NoShowsDto = z.output<typeof noShowsDto>;
export type HeatmapDto = z.output<typeof heatmapDto>;
export type IdleRankingDto = z.output<typeof idleRankingDto>;

// ---- Router ---------------------------------------------------------------

/**
 * Resolves and authorizes the scope (analytics:view). A named resource
 * decides the department; one outside the actor's departments is 404.
 */
async function authorizedScope(
  actor: Actor,
  query: z.output<typeof analyticsQuery>,
  resources: ResourceService,
): Promise<AnalyticsScope> {
  if (query.resourceId) {
    const resource = await resources.get(query.resourceId);
    const subject: AnalyticsSubject = { id: resource.id, departmentId: resource.departmentId };
    if (!can(actor, "analytics:view", subject)) throw denial(actor, "analytics:view", subject);
    // Asking for a resource under a department it doesn't belong to.
    if (query.departmentId && query.departmentId !== "all" && query.departmentId !== resource.departmentId) {
      throw resourceNotFound();
    }
    return { departmentId: resource.departmentId, resourceId: resource.id };
  }
  const subject: AnalyticsSubject =
    query.departmentId === "all"
      ? { departmentId: null }
      : query.departmentId
        ? { departmentId: query.departmentId }
        : defaultAnalyticsScope(actor);
  if (!can(actor, "analytics:view", subject)) throw denial(actor, "analytics:view", subject);
  return { departmentId: subject.departmentId, resourceId: null };
}

export function analyticsRouter(auth: AuthService, analytics: AnalyticsService, resources: ResourceService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  const parse = async (req: Request) => {
    const actor = actorOf(req);
    const query = analyticsQuery.parse(req.query);
    const scope = await authorizedScope(actor, query, resources);
    return { scope, window: { from: query.from, to: query.to } };
  };

  router.get("/utilization", async (req, res) => {
    const { scope, window } = await parse(req);
    respond(res, 200, utilizationDto, { scope, ...(await analytics.utilization(scope, window)) });
  });

  router.get("/no-shows", async (req, res) => {
    const { scope, window } = await parse(req);
    respond(res, 200, noShowsDto, { scope, ...(await analytics.noShows(scope, window)) });
  });

  router.get("/heatmap", async (req, res) => {
    const { scope, window } = await parse(req);
    respond(res, 200, heatmapDto, { scope, timezone: "Asia/Kolkata" as const, ...(await analytics.heatmap(scope, window)) });
  });

  router.get("/idle-ranking", async (req, res) => {
    const { scope, window } = await parse(req);
    respond(res, 200, idleRankingDto, { scope, ...(await analytics.idleRanking(scope, window)) });
  });

  return router;
}
