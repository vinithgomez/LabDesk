/**
 * The single authorization policy (CLAUDE.md §6). Every route handler calls
 * `can()` before invoking a mutating service; nothing else in the codebase
 * inspects `actor.role` to make an access decision.
 */
import { bookingNotFound, DomainError, resourceNotFound } from "../domain/errors.js";
import type { Actor, BookingListScope, BookingStatus } from "../domain/types.js";

/**
 * Subject for `resource:view`. `departmentId: null` means "every department"
 * (an unscoped listing), which only admins may request. `id` is present when
 * the subject is a concrete resource rather than a listing scope.
 */
export interface ResourceViewSubject {
  id?: string;
  departmentId: string | null;
}

/** Subject for `resource:manage`. A resource being created has no id or owners yet. */
export interface ResourceManageSubject {
  id?: string;
  departmentId: string;
  ownerIds: readonly string[];
}

export interface RoleChangeSubject {
  targetUserId: string;
}

/** Subject for `booking:create`: the resource being booked. */
export interface BookingCreateSubject {
  id: string;
  departmentId: string;
  isActive: boolean;
}

/** Subject for `booking:view` / `booking:cancel`: a booking and its resource. */
export interface BookingSubject {
  id: string;
  userId: string;
  status: BookingStatus;
  resource: { id: string; departmentId: string; ownerIds: readonly string[] };
}

export interface PolicySubjects {
  "resource:view": ResourceViewSubject;
  "resource:manage": ResourceManageSubject;
  "user:change_role": RoleChangeSubject;
  "booking:create": BookingCreateSubject;
  "booking:view": BookingSubject;
  "booking:cancel": BookingSubject;
}

export type Action = keyof PolicySubjects;

type Rule<A extends Action> = (actor: Actor, subject: PolicySubjects[A]) => boolean;

const isAdmin = (actor: Actor): boolean => actor.role === "admin";

/** Department scoping (§2b): same department only; admins see all. */
const canSeeDepartment = (actor: Actor, departmentId: string | null): boolean =>
  isAdmin(actor) || (departmentId !== null && departmentId === actor.departmentId);

/** Resource owner, pinned to the actor's own department (as for resource:manage). */
const ownsResource = (actor: Actor, r: { departmentId: string; ownerIds: readonly string[] }): boolean =>
  r.departmentId === actor.departmentId && r.ownerIds.includes(actor.id);

/** Once the user is in the room, only staff can end the booking early (§5, §6). */
const BOOKER_CANNOT_CANCEL: readonly BookingStatus[] = ["checked_in", "completed"];

const rules: { [A in Action]: Rule<A> } = {
  "resource:view": (actor, s) => canSeeDepartment(actor, s.departmentId),

  // Resource owner or admin (§6). Ownership is also pinned to the actor's
  // department so a stale owner row can never reach across departments.
  "resource:manage": (actor, s) =>
    isAdmin(actor) || (s.departmentId === actor.departmentId && s.ownerIds.includes(actor.id)),

  // Only an admin can change a role (§2b), and never their own — an admin
  // demoting themselves could leave the system with no admin.
  "user:change_role": (actor, s) => isAdmin(actor) && s.targetUserId !== actor.id,

  // Any active user; the resource must be active and in the actor's own
  // department (§6). This applies to admins too: seeing every department is
  // not the same as booking in every department.
  "booking:create": (actor, r) => r.isActive && r.departmentId === actor.departmentId,

  // The booker, the resource's owners (who approve and manage it) and admins.
  "booking:view": (actor, b) => isAdmin(actor) || b.userId === actor.id || ownsResource(actor, b.resource),

  // §6: owner of booking (if not checked in) OR resource owner OR admin.
  // Whether the booking is still cancellable at all is the state machine's
  // call (transitionBooking), not the policy's.
  "booking:cancel": (actor, b) =>
    isAdmin(actor) ||
    ownsResource(actor, b.resource) ||
    (b.userId === actor.id && !BOOKER_CANNOT_CANCEL.includes(b.status)),
};

export function can<A extends Action>(actor: Actor, action: A, subject: PolicySubjects[A]): boolean {
  if (!actor.isActive) return false;
  const rule: Rule<A> = rules[action];
  return rule(actor, subject);
}

/**
 * The list scope a resource listing uses when the caller didn't ask for one:
 * admins default to every department (null), everyone else to their own.
 * The chosen scope is still passed through `can(actor, "resource:view", ...)`.
 */
export function defaultResourceScope(actor: Actor): ResourceViewSubject {
  return { departmentId: isAdmin(actor) ? null : actor.departmentId };
}

/**
 * The bookings a listing may return (the list-level form of booking:view).
 * `mine` narrows to the actor's own bookings for everyone.
 */
export function bookingListScope(actor: Actor, opts: { mine: boolean }): BookingListScope {
  if (opts.mine) return { kind: "own", userId: actor.id };
  return isAdmin(actor) ? { kind: "all" } : { kind: "ownOrManaged", userId: actor.id };
}

type Denial<A extends Action> = (actor: Actor, subject: PolicySubjects[A]) => DomainError | null;

/**
 * Action-specific denial errors. Anything a rule here doesn't claim becomes
 * FORBIDDEN. A concrete resource outside the actor's visible departments is
 * always reported exactly like a missing row (404 NOT_FOUND), so the API
 * never confirms it exists (§2c).
 */
const hiddenResource = (actor: Actor, s: { id?: string; departmentId: string | null }): DomainError | null =>
  s.id !== undefined && !canSeeDepartment(actor, s.departmentId) ? resourceNotFound() : null;

const denials: { [A in Action]?: Denial<A> } = {
  "resource:view": hiddenResource,
  "resource:manage": hiddenResource,
  "booking:create": (actor, r) => {
    const hidden = hiddenResource(actor, r);
    if (hidden) return hidden;
    // Visible (admins see all departments) but not bookable from here (§2c).
    if (r.departmentId !== actor.departmentId) {
      return new DomainError("WRONG_DEPARTMENT", "You can only book resources in your own department");
    }
    if (!r.isActive) return new DomainError("FORBIDDEN", "This resource is not accepting bookings");
    return null;
  },
  // A booking you may not see is indistinguishable from one that doesn't exist.
  "booking:view": () => bookingNotFound(),
  "booking:cancel": (actor, b) => (can(actor, "booking:view", b) ? null : bookingNotFound()),
};

/** The error to raise after `can()` returned false. */
export function denial<A extends Action>(actor: Actor, action: A, subject: PolicySubjects[A]): DomainError {
  const specific: Denial<A> | undefined = denials[action];
  return specific?.(actor, subject) ?? new DomainError("FORBIDDEN", `You are not allowed to perform ${action}`);
}
