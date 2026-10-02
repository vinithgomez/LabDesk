/** Wire shapes of the booking endpoints (server/src/routes/bookings.routes.ts). Times are UTC ISO strings. */

export type BookingStatus = "pending" | "approved" | "rejected" | "cancelled" | "checked_in" | "completed" | "no_show";

export interface Booking {
  id: string;
  resourceId: string;
  userId: string;
  start: string;
  end: string;
  status: BookingStatus;
  purpose: string;
  attendeeCount: number;
  seriesId: string | null;
  cancelledByMaintenanceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  level: number;
  approverId: string;
  decision: "approved" | "rejected";
  comment: string;
  decidedAt: string;
}

export interface Cancellation {
  kind: "maintenance";
  message: string;
  maintenance: { id: string; start: string; end: string; reason: string };
}

/** GET /api/bookings/:id */
export interface BookingDetail extends Booking {
  approvals: Approval[];
  awaitingLevel: number | null;
  cancellation: Cancellation | null;
}

/** GET /api/resources/:id/availability — busy times, never whose. */
export type BusyInterval =
  | { kind: "booking"; start: string; end: string; status: BookingStatus }
  | { kind: "maintenance"; start: string; end: string };

export interface Availability {
  resourceId: string;
  from: string;
  to: string;
  busy: BusyInterval[];
}

/** GET /api/waitlist (server/src/routes/waitlist.routes.ts waitlistEntryDto). */
export interface WaitlistEntry {
  id: string;
  resourceId: string;
  userId: string;
  desiredPeriod: { start: string; end: string };
  purpose: string;
  attendeeCount: number;
  status: "waiting" | "promoted" | "expired" | "cancelled";
  /** The booking a promoted entry became. */
  bookingId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewBooking {
  resourceId: string;
  start: string;
  end: string;
  purpose: string;
  attendeeCount: number;
}
