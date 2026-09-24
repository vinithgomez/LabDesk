import { Router } from "express";
import { z } from "zod";
import { can, denial, type BookingSubject } from "../auth/policy.js";
import { DomainError } from "../domain/errors.js";
import { CHECKIN_METHODS, CHECKOUT_METHODS } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import type { RateLimiter } from "../http/rate-limit.js";
import { isoDateTime, respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { BookingService } from "../services/booking.service.js";
import type { AttendanceTarget, CheckinService, ManualTarget } from "../services/checkin.service.js";
import { bookingDto, toBookingDto } from "./bookings.routes.js";

// ---- Request schemas ------------------------------------------------------

/** What the scanned QR carries (§7). */
export const scanBody = z.strictObject({
  resourceId: z.uuid(),
  sig: z.string().min(1).max(128),
});

/** Staff override when a phone can't scan: the booking to check in or out. */
export const manualCheckinBody = z.strictObject({ bookingId: z.uuid() });

// ---- Response schemas -----------------------------------------------------

export const checkinDto = z.object({
  checkedInAt: isoDateTime,
  checkedOutAt: isoDateTime.nullable(),
  checkinMethod: z.enum(CHECKIN_METHODS),
  overriddenBy: z.string().nullable(),
  checkoutMethod: z.enum(CHECKOUT_METHODS).nullable(),
  checkoutOverriddenBy: z.string().nullable(),
});

export const attendanceResultDto = z.object({
  action: z.enum(["checked_in", "checked_out"]),
  booking: bookingDto,
  resource: z.object({ id: z.string(), name: z.string() }),
  checkin: checkinDto,
});

export type ScanBody = z.input<typeof scanBody>;
export type ManualCheckinBody = z.input<typeof manualCheckinBody>;
export type AttendanceResultDto = z.output<typeof attendanceResultDto>;

const overrideSubject = ({ booking, resource }: ManualTarget): BookingSubject => ({
  id: booking.id,
  userId: booking.userId,
  status: booking.status,
  resource: { id: resource.id, departmentId: resource.departmentId, ownerIds: resource.ownerIds },
});

// ---- Router ---------------------------------------------------------------

export function checkinRouter(
  auth: AuthService,
  checkins: CheckinService,
  bookings: BookingService,
  scanLimiter: RateLimiter,
): Router {
  const router = Router();
  router.use(requireAuth(auth));

  const finish = async (target: AttendanceTarget, method: "qr" | "manual_override", actor: ReturnType<typeof actorOf>) => {
    const booking = await bookings.transitionBooking(target.booking.id, target.kind, actor, { method });
    const checkin = await checkins.checkinOf(booking.id);
    if (!checkin) throw new Error("check-in row missing after transition");
    return {
      action: target.kind === "checkin" ? ("checked_in" as const) : ("checked_out" as const),
      booking: toBookingDto(booking),
      resource: { id: target.resource.id, name: target.resource.name },
      checkin,
    };
  };

  /** A scan: first -> checked_in, second during the session -> completed. */
  router.post("/", async (req, res) => {
    const actor = actorOf(req);
    const { resourceId, sig } = scanBody.parse(req.body);

    // Counted before the signature check, so forged attempts are limited too.
    const limit = await scanLimiter.hit(`${actor.id}:${resourceId}`);
    if (!limit.allowed) {
      res.set("Retry-After", String(Math.ceil(limit.resetInMs / 1000)));
      throw new DomainError("RATE_LIMITED", "Too many scans for this resource; wait a minute and try again");
    }

    const target = await checkins.resolveScan(actor, resourceId, sig);
    const subject = { bookingUserId: target.booking.userId };
    if (!can(actor, "checkin:create", subject)) throw denial(actor, "checkin:create", subject);

    respond(res, 200, attendanceResultDto, await finish(target, "qr", actor));
  });

  /** Manual override by a resource owner or admin; records overridden_by. */
  router.post("/manual", async (req, res) => {
    const actor = actorOf(req);
    const { bookingId } = manualCheckinBody.parse(req.body);

    const target = await checkins.resolveManual(bookingId);
    const subject = overrideSubject(target);
    if (!can(actor, "checkin:override", subject)) throw denial(actor, "checkin:override", subject);
    // State is reported only after authorization.
    if (!target.kind) {
      throw new DomainError(
        "INVALID_TRANSITION",
        `A booking that is ${target.booking.status} cannot be checked in or out`,
      );
    }

    respond(res, 200, attendanceResultDto, await finish({ ...target, kind: target.kind }, "manual_override", actor));
  });

  return router;
}
