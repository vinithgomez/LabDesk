/**
 * The single authorization policy (CLAUDE.md §6). Every route handler calls
 * `can()` before invoking a service; nothing else in the codebase inspects
 * `actor.role` to make an access decision.
 *
 * Phase 1 actions only. Later phases add booking/maintenance/analytics
 * actions here.
 */
import { DomainError } from "../domain/errors.js";
import type { Actor } from "../domain/types.js";

/**
 * Subject for `resource:view`. `departmentId: null` means "every department"
 * (an unscoped listing), which only admins may request.
 */
export interface ResourceViewSubject {
  departmentId: string | null;
}

/** Subject for `resource:manage`. A resource being created has no owners yet. */
export interface ResourceManageSubject {
  departmentId: string;
  ownerIds: readonly string[];
}

export interface RoleChangeSubject {
  targetUserId: string;
}

export interface PolicySubjects {
  "resource:view": ResourceViewSubject;
  "resource:manage": ResourceManageSubject;
  "user:change_role": RoleChangeSubject;
}

export type Action = keyof PolicySubjects;

type Rule<A extends Action> = (actor: Actor, subject: PolicySubjects[A]) => boolean;

const isAdmin = (actor: Actor): boolean => actor.role === "admin";

const rules: { [A in Action]: Rule<A> } = {
  // Department scoping (§2b): same department only; admins see all.
  "resource:view": (actor, s) => isAdmin(actor) || (s.departmentId !== null && s.departmentId === actor.departmentId),

  // Resource owner or admin (§6). Ownership is also pinned to the actor's
  // department so a stale owner row can never reach across departments.
  "resource:manage": (actor, s) =>
    isAdmin(actor) || (s.departmentId === actor.departmentId && s.ownerIds.includes(actor.id)),

  // Only an admin can change a role (§2b), and never their own — an admin
  // demoting themselves could leave the system with no admin.
  "user:change_role": (actor, s) => isAdmin(actor) && s.targetUserId !== actor.id,
};

export function can<A extends Action>(actor: Actor, action: A, subject: PolicySubjects[A]): boolean {
  if (!actor.isActive) return false;
  const rule: Rule<A> = rules[action];
  return rule(actor, subject);
}

/**
 * The department scope a listing uses when the caller didn't ask for one:
 * admins default to every department (null), everyone else to their own.
 * The chosen scope is still passed through `can(actor, "resource:view", ...)`.
 */
export function defaultResourceScope(actor: Actor): ResourceViewSubject {
  return { departmentId: isAdmin(actor) ? null : actor.departmentId };
}

/**
 * The error to raise after `can()` returned false. Cross-department denials
 * get WRONG_DEPARTMENT so clients can tell scoping apart from missing rights.
 */
export function denial<A extends Action>(actor: Actor, action: A, subject: PolicySubjects[A]): DomainError {
  const departmentId = "departmentId" in subject ? subject.departmentId : undefined;
  if (typeof departmentId === "string" && departmentId !== actor.departmentId && !isAdmin(actor)) {
    return new DomainError("WRONG_DEPARTMENT", "You can only access resources in your own department");
  }
  return new DomainError("FORBIDDEN", `You are not allowed to perform ${action}`);
}
