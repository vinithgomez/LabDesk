/**
 * Wire types for check-in. These mirror the server's Zod response schemas in
 * server/src/routes/checkin.routes.ts (attendanceResultDto) — keep in sync.
 */

export interface CheckinPayload {
  resourceId: string;
  sig: string;
}

export interface AttendanceResult {
  action: "checked_in" | "checked_out";
  booking: { id: string; start: string; end: string; status: string };
  resource: { id: string; name: string };
  checkin: { checkedInAt: string; checkedOutAt: string | null };
}

/** `details` of a 404 NO_ACTIVE_BOOKING, when a nearby booking exists. */
export interface NoActiveBookingDetails {
  booking: { id: string; start: string; end: string; status: string };
  checkInOpensAt: string;
  checkInClosesAt: string;
}
