import { describe, expect, it } from "vitest";
import {
  approvalProgress,
  assertApprovalLevelsCovered,
  assertOwnerLevelsInRange,
  isStalled,
  STALL_AFTER_MS,
} from "./approvals.js";
import { DomainError } from "./errors.js";

const twoLevel = { requiresApproval: true, approvalLevels: 2 };
const approved = (level: number, approverId: string) => ({ level, approverId, decision: "approved" as const });
const rejected = (level: number, approverId: string) => ({ level, approverId, decision: "rejected" as const });

const codeOf = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
};

describe("approvalProgress", () => {
  it("awaits levels strictly in order and stops at the required count", () => {
    expect(approvalProgress(twoLevel, []).nextLevel).toBe(1);
    expect(approvalProgress(twoLevel, [approved(1, "a")]).nextLevel).toBe(2);
    expect(approvalProgress(twoLevel, [approved(1, "a"), approved(2, "b")]).nextLevel).toBeNull();
  });

  it("has no next level after any rejection", () => {
    expect(approvalProgress(twoLevel, [rejected(1, "a")]).nextLevel).toBeNull();
    expect(approvalProgress(twoLevel, [approved(1, "a"), rejected(2, "b")]).nextLevel).toBeNull();
  });

  it("lists everyone who has decided", () => {
    expect(approvalProgress(twoLevel, [approved(1, "a"), rejected(2, "b")]).deciderIds).toEqual(["a", "b"]);
  });
});

describe("isStalled", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("is true only for partially-approved bookings waiting at least STALL_AFTER_MS", () => {
    const partial = approvalProgress(twoLevel, [approved(1, "a")]);
    expect(isStalled(partial, ago(STALL_AFTER_MS - 1), now)).toBe(false);
    expect(isStalled(partial, ago(STALL_AFTER_MS), now)).toBe(true);
  });

  it("is false while no level has approved yet, or once nothing is awaited", () => {
    expect(isStalled(approvalProgress(twoLevel, []), ago(10 * STALL_AFTER_MS), now)).toBe(false);
    expect(isStalled(approvalProgress(twoLevel, [rejected(1, "a")]), ago(10 * STALL_AFTER_MS), now)).toBe(false);
  });
});

describe("owner invariants", () => {
  it("requires an owner at every required level when approval is required", () => {
    expect(codeOf(() => assertApprovalLevelsCovered(twoLevel, [{ userId: "a", approvalLevel: 1 }]))).toBe(
      "OWNER_REQUIRED",
    );
    expect(codeOf(() => assertApprovalLevelsCovered({ requiresApproval: true, approvalLevels: 1 }, []))).toBe(
      "OWNER_REQUIRED",
    );
    expect(
      codeOf(() =>
        assertApprovalLevelsCovered(twoLevel, [
          { userId: "a", approvalLevel: 1 },
          { userId: "b", approvalLevel: 2 },
        ]),
      ),
    ).toBeNull();
    expect(codeOf(() => assertApprovalLevelsCovered({ requiresApproval: false, approvalLevels: 2 }, []))).toBeNull();
  });

  it("keeps owner levels within the resource's approval_levels", () => {
    expect(codeOf(() => assertOwnerLevelsInRange({ approvalLevels: 1 }, [{ userId: "a", approvalLevel: 2 }]))).toBe(
      "INVALID_OWNER",
    );
    expect(codeOf(() => assertOwnerLevelsInRange({ approvalLevels: 2 }, [{ userId: "a", approvalLevel: 2 }]))).toBeNull();
  });
});
