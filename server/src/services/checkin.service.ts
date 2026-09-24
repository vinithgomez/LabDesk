import QRCode from "qrcode";
import { checkinUrl, signResourceQr, verifyResourceQr } from "../auth/qr-signature.js";
import { checkInWindow, decideScan, explainNoActiveBooking } from "../domain/checkin-rules.js";
import { bookingNotFound, DomainError, resourceNotFound } from "../domain/errors.js";
import type { Actor, Booking, Checkin, Resource } from "../domain/types.js";
import type { UnitOfWork } from "../repositories/index.js";

/** How far around now a scan looks for the caller's bookings on the resource. */
const SCAN_LOOKAROUND_MS = 12 * 60 * 60 * 1000;

export interface ResourceQr {
  /** The URL the QR encodes: {PUBLIC_APP_URL}/checkin?r=<id>&sig=<hmac>. */
  url: string;
  png: Buffer;
}

/** What a scan or manual override will do, resolved before anything mutates. */
export interface AttendanceTarget {
  kind: "checkin" | "checkout";
  booking: Booking;
  resource: Resource;
  checkin: Checkin | null;
}

/**
 * A manual-override candidate. `kind` is null when the booking's status allows
 * neither check-in nor check-out; the route reports that only after
 * authorizing, so a caller who can't see the booking learns nothing about it.
 */
export interface ManualTarget {
  kind: "checkin" | "checkout" | null;
  booking: Booking;
  resource: Resource;
  checkin: Checkin | null;
}

/**
 * Check-in use cases (CLAUDE.md §7). This service only resolves and reads;
 * every state change goes through BookingService.transitionBooking after the
 * route has called can().
 */
export class CheckinService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly publicAppUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The printable QR for a resource. Deterministic: the same PNG every time. */
  async qrFor(resourceId: string): Promise<ResourceQr> {
    const creds = await this.uow.read.resources.findQrCredentials(resourceId);
    if (!creds) throw resourceNotFound();
    const url = checkinUrl(this.publicAppUrl, creds.id, signResourceQr(creds.qrSecret, creds.id));
    const png = await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 2, width: 512 });
    return { url, png };
  }

  /**
   * Verifies a scanned QR and works out what the caller's scan means.
   * INVALID_QR for a forged/unknown code or a retired resource;
   * NO_ACTIVE_BOOKING (naming the nearest booking) when there is nothing to
   * check in to or out of right now.
   */
  async resolveScan(actor: Actor, resourceId: string, sig: string): Promise<AttendanceTarget> {
    const creds = await this.uow.read.resources.findQrCredentials(resourceId);
    // Unknown resource and bad signature are indistinguishable to the caller.
    if (!creds || !verifyResourceQr(creds.qrSecret, creds.id, sig)) {
      throw new DomainError("INVALID_QR", "This is not a valid LabDesk check-in code");
    }
    if (!creds.isActive) {
      throw new DomainError("INVALID_QR", "This resource is no longer in service; its check-in code has expired");
    }

    const now = this.now();
    const bookings = await this.uow.read.bookings.listForUserOnResource(
      actor.id,
      creds.id,
      ["pending", "approved", "checked_in"],
      new Date(now.getTime() - SCAN_LOOKAROUND_MS),
      new Date(now.getTime() + SCAN_LOOKAROUND_MS),
    );
    const outcome = decideScan(bookings, now);
    if (outcome.kind === "none") {
      const nearest = outcome.nearest;
      throw new DomainError(
        "NO_ACTIVE_BOOKING",
        explainNoActiveBooking(nearest, now),
        nearest
          ? {
              booking: {
                id: nearest.id,
                start: nearest.startsAt.toISOString(),
                end: nearest.endsAt.toISOString(),
                status: nearest.status,
              },
              checkInOpensAt: checkInWindow(nearest).opensAt.toISOString(),
              checkInClosesAt: checkInWindow(nearest).closesAt.toISOString(),
            }
          : undefined,
      );
    }
    return this.target(outcome.kind, outcome.booking);
  }

  /**
   * Manual override (§7, staff): checks the booking in if it's approved, out
   * if it's checked in. Timing rules are the same as for a scan and are
   * enforced by transitionBooking.
   */
  async resolveManual(bookingId: string): Promise<ManualTarget> {
    const booking = await this.uow.read.bookings.findById(bookingId);
    if (!booking) throw bookingNotFound();
    const kind = booking.status === "approved" ? "checkin" : booking.status === "checked_in" ? "checkout" : null;
    return { ...(await this.target("checkin", booking)), kind };
  }

  async checkinOf(bookingId: string): Promise<Checkin | null> {
    return this.uow.read.checkins.findByBookingId(bookingId);
  }

  private async target(kind: "checkin" | "checkout", booking: Booking): Promise<AttendanceTarget> {
    const [resource, checkin] = await Promise.all([
      this.uow.read.resources.findById(booking.resourceId),
      this.uow.read.checkins.findByBookingId(booking.id),
    ]);
    if (!resource) throw bookingNotFound();
    return { kind, booking, resource, checkin };
  }
}
