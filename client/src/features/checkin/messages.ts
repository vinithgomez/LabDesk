import { ApiError } from "../../lib/api";
import { describeApiError } from "../../lib/api-errors";
import type { AttendanceResult, NoActiveBookingDetails } from "./types";

/** Times render in the viewer's own zone; the API speaks UTC (CLAUDE.md §2.2). */
const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

const span = (start: string, end: string) =>
  `${time.format(new Date(start))}–${time.format(new Date(end))} on ${day.format(new Date(start))}`;

/**
 * What a scan did, in three parts: the title (unmissable), the reason, and
 * what to do next. `wait` is for a booking that exists but can't be checked
 * into yet (too early, still awaiting approval).
 */
export interface Outcome {
  tone: "success" | "wait" | "failure";
  title: string;
  detail: string;
  next: string;
}

export function successOutcome(result: AttendanceResult): Outcome {
  return result.action === "checked_in"
    ? {
        tone: "success",
        title: "Checked in",
        detail: `${result.resource.name}, ${span(result.booking.start, result.booking.end)}.`,
        next: "Scan the same code again when you leave, to check out.",
      }
    : {
        tone: "success",
        title: "Checked out",
        detail: `${result.resource.name}: thanks, your session is recorded.`,
        next: "Nothing else to do. Your next booking needs its own scan.",
      };
}

function isNoActiveDetails(d: unknown): d is NoActiveBookingDetails {
  if (typeof d !== "object" || d === null || !("booking" in d)) return false;
  const booking: unknown = d.booking;
  return typeof booking === "object" && booking !== null && "start" in booking && "checkInOpensAt" in d;
}

/** Plain-language failure for each server error, rendered in local time where relevant. */
export function failureOutcome(err: unknown): Outcome {
  if (!(err instanceof ApiError)) {
    return { tone: "failure", title: "Something went wrong", detail: "The check-in didn't go through.", next: "Please try again." };
  }

  switch (err.code) {
    case "NO_ACTIVE_BOOKING": {
      if (!isNoActiveDetails(err.details)) {
        return {
          tone: "failure",
          title: "No booking right now",
          detail: "You have no booking on this resource around this time.",
          next: "Check you're at the resource you booked, or book a time on its calendar first.",
        };
      }
      const { booking, checkInOpensAt } = err.details;
      if (booking.status === "pending") {
        return {
          tone: "wait",
          title: "Still awaiting approval",
          detail: `Your booking is ${span(booking.start, booking.end)}, and nobody has approved it yet.`,
          next: "You can check in once it's approved; My bookings shows when it is.",
        };
      }
      if (Date.now() < new Date(checkInOpensAt).getTime()) {
        return {
          tone: "wait",
          title: "Too early",
          detail: `Your booking is ${span(booking.start, booking.end)}. Check-in opens at ${time.format(new Date(checkInOpensAt))}.`,
          next: "Come back then and scan again.",
        };
      }
      return {
        tone: "failure",
        title: "Check-in has closed",
        detail: `Your booking was ${span(booking.start, booking.end)}. Check-in closes 15 minutes after the start.`,
        next: "Ask the lab in-charge if you're here, or book another time.",
      };
    }
    case "INVALID_QR":
      return { tone: "failure", title: "Not a valid code", detail: err.message, next: "Scan the QR code printed on the resource." };
    case "RATE_LIMITED":
      return { tone: "failure", title: "Too many scans", detail: describeApiError(err), next: "Wait a minute, then scan once." };
    case "NETWORK":
      return { tone: "failure", title: "Offline", detail: describeApiError(err), next: "Reconnect, then scan again." };
    default:
      return {
        tone: "failure",
        title: "Couldn't check in",
        detail: describeApiError(err),
        next: "Try again; if it keeps failing, ask the lab in-charge.",
      };
  }
}
