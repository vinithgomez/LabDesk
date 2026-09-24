import { ApiError } from "../../lib/api";
import type { AttendanceResult, NoActiveBookingDetails } from "./types";

/** Times render in the viewer's own zone; the API speaks UTC (CLAUDE.md §2.2). */
const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

const span = (start: string, end: string) =>
  `${time.format(new Date(start))}–${time.format(new Date(end))} on ${day.format(new Date(start))}`;

export interface Outcome {
  tone: "success" | "failure";
  title: string;
  detail: string;
}

export function successOutcome(result: AttendanceResult): Outcome {
  return result.action === "checked_in"
    ? {
        tone: "success",
        title: "Checked in",
        detail: `${result.resource.name} · ${span(result.booking.start, result.booking.end)}`,
      }
    : {
        tone: "success",
        title: "Checked out",
        detail: `${result.resource.name} · thanks, your session is recorded.`,
      };
}

function isNoActiveDetails(d: unknown): d is NoActiveBookingDetails {
  if (typeof d !== "object" || d === null || !("booking" in d)) return false;
  const booking: unknown = d.booking;
  return typeof booking === "object" && booking !== null && "start" in booking && "checkInOpensAt" in d;
}

/** Plain-language failure for each server error, rendered in local time where relevant. */
export function failureOutcome(err: unknown): Outcome {
  if (!(err instanceof ApiError)) return { tone: "failure", title: "Something went wrong", detail: "Please try again." };

  switch (err.code) {
    case "NO_ACTIVE_BOOKING": {
      if (!isNoActiveDetails(err.details)) {
        return { tone: "failure", title: "No booking right now", detail: "You have no booking on this resource around this time." };
      }
      const { booking, checkInOpensAt } = err.details;
      if (booking.status === "pending") {
        return { tone: "failure", title: "Still awaiting approval", detail: `Your booking is ${span(booking.start, booking.end)}.` };
      }
      if (Date.now() < new Date(checkInOpensAt).getTime()) {
        return {
          tone: "failure",
          title: "Too early",
          detail: `Your booking is ${span(booking.start, booking.end)}. Check-in opens at ${time.format(new Date(checkInOpensAt))}.`,
        };
      }
      return {
        tone: "failure",
        title: "Check-in has closed",
        detail: `Your booking was ${span(booking.start, booking.end)}. Check-in closes 15 minutes after the start.`,
      };
    }
    case "INVALID_QR":
      return { tone: "failure", title: "Not a valid code", detail: err.message };
    case "RATE_LIMITED":
      return { tone: "failure", title: "Too many scans", detail: "Wait a minute, then try again." };
    case "NETWORK":
      return { tone: "failure", title: "Offline", detail: err.message };
    default:
      return { tone: "failure", title: "Couldn't check in", detail: err.message };
  }
}
