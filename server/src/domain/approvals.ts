/**
 * Pure approval rules (CLAUDE.md §4 booking_approvals, §5, §6). No I/O.
 */
import { DomainError } from "./errors.js";
import type { BookingApproval, Resource, ResourceOwner } from "./types.js";

/**
 * A partially-approved booking whose next level has waited at least this long
 * is reported as stalled in the approvals inbox. See `isStalled`.
 */
export const STALL_AFTER_MS = 24 * 60 * 60 * 1000;

export interface ApprovalProgress {
  /** Levels this booking needs (the resource's approval_levels). */
  requiredLevels: number;
  /** Levels approved so far, ascending. Always a prefix 1..n. */
  approvedLevels: number[];
  /** The level that must decide next, or null once no decision is pending. */
  nextLevel: number | null;
  /** Everyone who has already decided on this booking at any level. */
  deciderIds: string[];
}

/**
 * Levels a booking on this resource needs. Bookings on resources that do not
 * require approval are created 'approved' and never reach this; the fallback
 * of 1 only covers pending rows from before approvals existed.
 */
export function requiredLevels(resource: Pick<Resource, "requiresApproval" | "approvalLevels">): number {
  return resource.requiresApproval ? resource.approvalLevels : 1;
}

/**
 * Where a pending booking stands. Levels are decided strictly in order, so
 * the next level is always one past the highest approved level. Any
 * rejection ends the process: there is no next level after it.
 */
export function approvalProgress(
  resource: Pick<Resource, "requiresApproval" | "approvalLevels">,
  approvals: readonly Pick<BookingApproval, "level" | "decision" | "approverId">[],
): ApprovalProgress {
  const required = requiredLevels(resource);
  const approvedLevels = approvals
    .filter((a) => a.decision === "approved")
    .map((a) => a.level)
    .sort((x, y) => x - y);
  const rejected = approvals.some((a) => a.decision === "rejected");
  const next = approvedLevels.length + 1;
  return {
    requiredLevels: required,
    approvedLevels,
    nextLevel: rejected || next > required ? null : next,
    deciderIds: approvals.map((a) => a.approverId),
  };
}

/**
 * A booking is stalled when at least one level has approved it and the next
 * level has not acted for STALL_AFTER_MS. Such a booking holds its slot while
 * nobody moves it forward, so the inbox flags it rather than leaving it to
 * look like any other pending request. Computed on read: no background job.
 */
export function isStalled(progress: ApprovalProgress, awaitingSince: Date, now: Date): boolean {
  return (
    progress.nextLevel !== null &&
    progress.approvedLevels.length > 0 &&
    now.getTime() - awaitingSince.getTime() >= STALL_AFTER_MS
  );
}

/**
 * A resource that requires approval must keep at least one owner at every
 * level it requires; otherwise bookings needing that level could only ever be
 * decided by an admin. Throws OWNER_REQUIRED naming the uncovered levels.
 */
export function assertApprovalLevelsCovered(
  config: Pick<Resource, "requiresApproval" | "approvalLevels">,
  owners: readonly ResourceOwner[],
): void {
  if (!config.requiresApproval) return;
  const missing: number[] = [];
  for (let level = 1; level <= config.approvalLevels; level += 1) {
    if (!owners.some((o) => o.approvalLevel === level)) missing.push(level);
  }
  if (missing.length > 0) {
    throw new DomainError(
      "OWNER_REQUIRED",
      `A resource that requires approval needs at least one owner at every approval level (missing: ${missing.join(", ")})`,
      { missingLevels: missing },
    );
  }
}

/** Owners may only be assigned to levels the resource actually uses. */
export function assertOwnerLevelsInRange(
  config: Pick<Resource, "approvalLevels">,
  owners: readonly ResourceOwner[],
): void {
  const bad = owners.filter((o) => o.approvalLevel < 1 || o.approvalLevel > config.approvalLevels);
  if (bad.length > 0) {
    throw new DomainError(
      "INVALID_OWNER",
      `Owner approval levels must be between 1 and ${config.approvalLevels} for this resource`,
      bad.map((o) => ({ userId: o.userId, reason: `approval level ${o.approvalLevel} is out of range` })),
    );
  }
}
