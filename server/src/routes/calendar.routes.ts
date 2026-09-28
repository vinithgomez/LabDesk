import { Router } from "express";
import { z } from "zod";
import { can, denial } from "../auth/policy.js";
import { DomainError } from "../domain/errors.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { CalendarService } from "../services/calendar.service.js";

// POST .../regenerate takes no body; anything sent is rejected like any unknown field.
export const regenerateFeedBody = z.strictObject({}).optional();

/** The caller's calendar subscription URL. Treat it like a password: it shows their bookings. */
export const feedDto = z.object({ url: z.string() });
export type FeedDto = z.output<typeof feedDto>;

const ICS_SUFFIX = ".ics";

export function calendarRouter(auth: AuthService, calendar: CalendarService): Router {
  const router = Router();

  router.get("/feed", requireAuth(auth), async (req, res) => {
    const actor = actorOf(req);
    const subject = { userId: actor.id };
    if (!can(actor, "calendar:manage", subject)) throw denial(actor, "calendar:manage", subject);
    respond(res, 200, feedDto, { url: await calendar.feedUrl(actor) });
  });

  router.post("/feed/regenerate", requireAuth(auth), async (req, res) => {
    const actor = actorOf(req);
    regenerateFeedBody.parse(req.body);
    const subject = { userId: actor.id };
    if (!can(actor, "calendar:manage", subject)) throw denial(actor, "calendar:manage", subject);
    respond(res, 200, feedDto, { url: await calendar.regenerate(actor) });
  });

  /**
   * GET /api/calendar/:icsToken.ics — unauthenticated: calendar apps can't
   * sign in, so the token in the URL is the credential. Never cached, so a
   * regenerated feed stops working everywhere immediately.
   */
  router.get("/:file", async (req, res) => {
    const file = req.params.file;
    if (!file.endsWith(ICS_SUFFIX)) throw new DomainError("NOT_FOUND", "Calendar feed not found");
    const body = await calendar.render(file.slice(0, -ICS_SUFFIX.length));
    res
      .status(200)
      .set({
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="labdesk.ics"',
        "Cache-Control": "no-store",
      })
      .send(body);
  });

  return router;
}
