import type { BookingStatus } from "./types";

/**
 * Colour is semantic only: amber pending, green approved (and what follows
 * approval), red rejected. Everything else is neutral.
 */
export type StatusTone = "pending" | "approved" | "rejected" | "neutral";

export function statusTone(status: BookingStatus | "expired"): StatusTone {
  switch (status) {
    case "pending":
      return "pending";
    case "approved":
    case "checked_in":
    case "completed":
      return "approved";
    case "rejected":
    case "expired":
    case "no_show":
      return "rejected";
    case "cancelled":
      return "neutral";
  }
}

/** Waitlist entries use the same semantic colours: waiting amber, booked green, expired red. */
export const WAITLIST_STATUS: Record<"waiting" | "promoted" | "expired" | "cancelled", { label: string; tone: StatusTone }> = {
  waiting: { label: "Waiting", tone: "pending" },
  promoted: { label: "Booked for you", tone: "approved" },
  expired: { label: "Expired", tone: "rejected" },
  cancelled: { label: "Left", tone: "neutral" },
};

export const STATUS_LABEL: Record<BookingStatus | "expired", string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  checked_in: "Checked in",
  completed: "Completed",
  no_show: "No-show",
  expired: "Expired",
};
