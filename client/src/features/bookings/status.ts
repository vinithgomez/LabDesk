import type { StatusKind } from "../../components/ui";
import type { BookingStatus } from "./types";

/** Waitlist entries borrow a booking status's look: waiting looks pending, booked looks approved. */
export const WAITLIST_STATUS: Record<"waiting" | "promoted" | "expired" | "cancelled", { label: string; look: StatusKind }> = {
  waiting: { label: "Waiting", look: "pending" },
  promoted: { label: "Booked for you", look: "approved" },
  expired: { label: "Expired", look: "expired" },
  cancelled: { label: "Left", look: "cancelled" },
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
