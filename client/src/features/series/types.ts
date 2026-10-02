import type { BookingStatus } from "../bookings/types";

/** GET /api/series/:id, and the POST /api/series response (server/src/routes/series.routes.ts seriesDto). */
export interface SeriesDetail {
  id: string;
  resourceId: string;
  userId: string;
  rrule: string;
  /** IST "HH:MM". */
  startTime: string;
  durationMinutes: number;
  purpose: string;
  attendeeCount: number;
  status: "active" | "cancelled";
  materializedThrough: string | null;
  cancelledAt: string | null;
  createdAt: string;
  occurrences: { bookingId: string; start: string; end: string; status: BookingStatus }[];
  /** Occurrences the server couldn't book, with the rule that refused each (a domain error code). */
  skipped: { start: string; end: string; reason: string; message: string; recordedAt: string }[];
}
