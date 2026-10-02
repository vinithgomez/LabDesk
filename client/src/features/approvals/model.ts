/**
 * Approvals-inbox rules, kept out of the components: what an item can still
 * be, why the caller can't decide it, and the context that turns an approval
 * refusal into the right sentence.
 */
import type { ApprovalErrorContext } from "../../lib/api-errors";
import type { Booking, BookingStatus } from "../bookings/types";

/** GET /api/bookings/pending: one item (server/src/routes/bookings.routes.ts inboxItemDto). */
export interface InboxItem extends Booking {
  approvals: {
    level: number;
    approverId: string;
    approverName: string;
    decision: "approved" | "rejected";
    comment: string;
    decidedAt: string;
  }[];
  awaitingLevel: number | null;
  booker: { id: string; fullName: string };
  resource: { id: string; name: string };
  awaitingSince: string;
  /** Level 1 approved and level 2 silent for 24 hours. */
  stalled: boolean;
  /** Start time has passed: it can be rejected, not approved. */
  lapsed: boolean;
  /** The caller may decide it now (booking:approve). */
  canDecide: boolean;
}

/** The decision response: the booking with its trail. */
export interface DecisionResult extends Booking {
  status: BookingStatus;
  awaitingLevel: number | null;
}

export type Decision = "approve" | "reject";

/** Lapsed by the server's flag, or since the list was fetched. */
export function isLapsed(item: Pick<InboxItem, "lapsed" | "start">, now: Date): boolean {
  return item.lapsed || new Date(item.start).getTime() <= now.getTime();
}

/** Which buttons an item shows. Approve is withheld once the start has passed. */
export function availableActions(item: InboxItem, now: Date): { approve: boolean; reject: boolean } {
  if (!item.canDecide) return { approve: false, reject: false };
  return { approve: !isLapsed(item, now), reject: true };
}

/** For items the caller can see but not decide (the "everything pending" view). */
export function whyNotDecidable(item: InboxItem, meId: string): string | null {
  if (item.canDecide) return null;
  if (item.booker.id === meId) return "Your own booking: someone else decides it.";
  if (item.approvals.some((a) => a.approverId === meId)) {
    return `You decided an earlier level; level ${item.awaitingLevel ?? "?"} needs a different approver.`;
  }
  return item.awaitingLevel !== null
    ? `Awaiting level ${item.awaitingLevel}, which isn't yours to decide.`
    : "Not yours to decide.";
}

/** What describeApiError needs to name an approval refusal precisely. */
export function approvalErrorContext(item: InboxItem, action: Decision, meId: string, now: Date): ApprovalErrorContext {
  return {
    action,
    ownBooking: item.booker.id === meId,
    decidedEarlierLevel: item.approvals.some((a) => a.approverId === meId),
    awaitingLevel: item.awaitingLevel,
    lapsed: isLapsed(item, now),
  };
}

/** The line announced after a decision lands. */
export function decisionSummary(item: InboxItem, action: Decision, result: Pick<DecisionResult, "status" | "awaitingLevel">, when: string): string {
  const what = `${item.resource.name}, ${when}, for ${item.booker.fullName}`;
  if (action === "reject") return `Rejected: ${what}.`;
  if (result.status === "approved") return `Approved: ${what}.`;
  return `Level ${item.awaitingLevel ?? 1} approved: ${what}. It now awaits level ${result.awaitingLevel ?? "?"}.`;
}

/** A rejection must say why: the booker sees the comment. */
export function rejectionCommentError(comment: string): string | null {
  return comment.trim().length === 0 ? "Say why you're rejecting it; the booker sees this comment." : null;
}
