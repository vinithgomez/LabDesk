/**
 * The single authorization policy (CLAUDE.md §6). Every route handler calls
 * `can()` before invoking a mutating service; nothing else in the codebase
 * inspects `actor.role` to make an access decision.
 */
import {
  bookingNotFound,
  DomainError,
  incidentNotFound,
  resourceNotFound,
  seriesNotFound,
  waitlistEntryNotFound,
} from "../domain/errors.js";
import type { Actor, ApprovalInboxScope, BookingListScope, BookingStatus, UserRole } from "../domain/types.js";

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

/** Subject for `resource:manage_owners`: the resource whose owners change. */
export interface ResourceOwnersSubject {
  id: string;
  departmentId: string;
}

/**
 * Subject for `booking:approve` (which also covers reject): the booking, its
 * resource's owners with their approval levels, the level now awaiting a
 * decision (null if none is), and everyone who has already decided.
 */
export interface ApprovalSubject extends BookingSubject {
  resource: BookingSubject["resource"] & { owners: readonly { userId: string; approvalLevel: number }[] };
  nextLevel: number | null;
  deciderIds: readonly string[];
}

/** Subject for `checkin:create`: the booking the caller's scan resolved to. */
export interface CheckinSubject {
  bookingUserId: string;
}

/** Subject for `waitlist:cancel`: the entry's owner. */
export interface WaitlistSubject {
  userId: string;
}

/** Subject for `series:view` / `series:cancel`: a series and its resource. */
export interface SeriesSubject {
  id: string;
  userId: string;
  resource: { id: string; departmentId: string; ownerIds: readonly string[] };
}

/**
 * Subject for `analytics:view`: the department whose analytics are requested
 * (null = every department). `id` is set when a single resource was named,
 * so a resource outside the actor's departments reads as missing.
 */
export interface AnalyticsSubject {
  id?: string;
  departmentId: string | null;
}

/** Subject for `calendar:manage`: whose calendar feed. */
export interface CalendarSubject {
  userId: string;
}

/** The resource side of an incident subject. */
interface IncidentResource {
  id: string;
  departmentId: string;
  ownerIds: readonly string[];
}

/**
 * Subject for `incident:report`: the resource, whether the reporter has ever
 * had a booking on it that held its slot, and — if the report names a
 * booking — whose booking that is.
 */
export interface IncidentReportSubject {
  resource: IncidentResource;
  reporterHadBooking: boolean;
  bookingUserId: string | null;
}

/** Subject for `incident:view` / `incident:resolve`. */
export interface IncidentSubject {
  reportedBy: string;
  resource: IncidentResource;
}

export interface PolicySubjects {
  "resource:view": ResourceViewSubject;
  "resource:manage": ResourceManageSubject;
  "resource:manage_owners": ResourceOwnersSubject;
  "user:change_role": RoleChangeSubject;
  "booking:create": BookingCreateSubject;
  "booking:view": BookingSubject;
  "booking:cancel": BookingSubject;
  "booking:approve": ApprovalSubject;
  "checkin:create": CheckinSubject;
  "checkin:override": BookingSubject;
  "waitlist:create": BookingCreateSubject;
  "waitlist:cancel": WaitlistSubject;
  "series:create": BookingCreateSubject;
  "series:view": SeriesSubject;
  "series:cancel": SeriesSubject;
  "analytics:view": AnalyticsSubject;
  "calendar:manage": CalendarSubject;
  "maintenance:create": ResourceManageSubject;
  "maintenance:remove": ResourceManageSubject;
  "incident:report": IncidentReportSubject;
  "incident:view": IncidentSubject;
  "incident:resolve": IncidentSubject;
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

/**
 * booking:create (§6): any active user; the resource must be active and in
 * the actor's own department. This applies to admins too: seeing every
 * department is not the same as booking in every department. Joining a
 * waitlist and creating a series are both requests to be booked, so they use
 * this rule unchanged.
 */
const mayBook = (actor: Actor, r: BookingCreateSubject): boolean =>
  r.isActive && r.departmentId === actor.departmentId;

/** §6 analytics:view: staff only. */
const ANALYTICS_ROLES: readonly UserRole[] = ["faculty", "lab_incharge", "admin"];

/** Once the user is in the room, only staff can end the booking early (§5, §6). */
const BOOKER_CANNOT_CANCEL: readonly BookingStatus[] = ["checked_in", "completed"];

const rules: { [A in Action]: Rule<A> } = {
  "resource:view": (actor, s) => canSeeDepartment(actor, s.departmentId),

  // Resource owner or admin (§6). Ownership is also pinned to the actor's
  // department so a stale owner row can never reach across departments.
  "resource:manage": (actor, s) =>
    isAdmin(actor) || (s.departmentId === actor.departmentId && s.ownerIds.includes(actor.id)),

  // Admin only. Owners approve bookings, so adding an owner grants approval
  // power; like resource creation, that is not delegated to owners.
  "resource:manage_owners": (actor) => isAdmin(actor),

  // Only an admin can change a role (§2b), and never their own — an admin
  // demoting themselves could leave the system with no admin.
  "user:change_role": (actor, s) => isAdmin(actor) && s.targetUserId !== actor.id,

  "booking:create": mayBook,

  // The booker, the resource's owners (who approve and manage it) and admins.
  "booking:view": (actor, b) => isAdmin(actor) || b.userId === actor.id || ownsResource(actor, b.resource),

  // §6: owner of booking (if not checked in) OR resource owner OR admin.
  // Whether the booking is still cancellable at all is the state machine's
  // call (transitionBooking), not the policy's.
  "booking:cancel": (actor, b) =>
    isAdmin(actor) ||
    ownsResource(actor, b.resource) ||
    (b.userId === actor.id && !BOOKER_CANNOT_CANCEL.includes(b.status)),

  // §6: resource owner with matching approval level, OR admin; never your
  // own booking. Also: one decision per person per booking (so nobody
  // satisfies both levels), and only within the actor's own department (an
  // admin sees other departments but does not decide for them). When no level
  // is awaiting a decision, any would-be approver passes here so the state
  // machine can report why the booking can't be decided (409).
  "booking:approve": (actor, s) => {
    if (actor.role === "student") return false;
    if (s.userId === actor.id || s.deciderIds.includes(actor.id)) return false;
    if (s.resource.departmentId !== actor.departmentId) return false;
    if (isAdmin(actor)) return true;
    return s.resource.owners.some(
      (o) => o.userId === actor.id && (s.nextLevel === null || o.approvalLevel === s.nextLevel),
    );
  },

  // Implicit via booking ownership: you scan yourself in, nobody else.
  "checkin:create": (actor, s) => s.bookingUserId === actor.id,

  // §6: resource owner or admin — an admin only within their own department
  // (as for approvals). Never on your own booking: an override stands in for
  // a scan by someone physically present, so staff scan their own bookings
  // like everyone else.
  "checkin:override": (actor, b) => {
    if (b.userId === actor.id) return false;
    if (b.resource.departmentId !== actor.departmentId) return false;
    return isAdmin(actor) || ownsResource(actor, b.resource);
  },

  // A waitlist entry is a booking request that waits: same rule as booking:create.
  "waitlist:create": mayBook,

  // Your own entries only. Nobody else holds a slot through your entry, so
  // there is nothing for staff to reclaim.
  "waitlist:cancel": (actor, e) => e.userId === actor.id,

  // A series books its occurrences for the caller: same rule as booking:create.
  "series:create": mayBook,

  // As booking:view: the series owner, the resource's owners and admins.
  "series:view": (actor, s) => isAdmin(actor) || s.userId === actor.id || ownsResource(actor, s.resource),

  // As booking:cancel: the series owner, a resource owner, or an admin.
  // Cancelling only touches occurrences the state machine lets 'cancel'
  // leave, so the booker's "not once checked in" limit is enforced there.
  "series:cancel": (actor, s) => isAdmin(actor) || s.userId === actor.id || ownsResource(actor, s.resource),

  // §6: faculty, lab_incharge, admin - department-scoped like everything
  // else. Faculty and in-charges see their own department only; an admin may
  // ask for another department or all of them (departmentId null).
  "analytics:view": (actor, s) => ANALYTICS_ROLES.includes(actor.role) && canSeeDepartment(actor, s.departmentId),

  // Your own feed only: it lists your bookings. Nobody reads or revokes
  // another user's feed, admins included.
  "calendar:manage": (actor, s) => s.userId === actor.id,

  // §6: resource owner or admin — the same people who manage the resource
  // (owners pinned to their own department, as for resource:manage).
  "maintenance:create": (actor, s) => isAdmin(actor) || ownsResource(actor, s),
  "maintenance:remove": (actor, s) => isAdmin(actor) || ownsResource(actor, s),

  // Anyone who has had a booking on the resource (in their own department),
  // plus the people who manage it. Only managers may tie a report to
  // someone else's booking (damage found after another person's session).
  "incident:report": (actor, s) => {
    const manages = isAdmin(actor) || ownsResource(actor, s.resource);
    if (s.bookingUserId !== null && s.bookingUserId !== actor.id && !manages) return false;
    return manages || (s.reporterHadBooking && s.resource.departmentId === actor.departmentId);
  },

  // The reporter, and whoever manages the resource.
  "incident:view": (actor, s) => isAdmin(actor) || s.reportedBy === actor.id || ownsResource(actor, s.resource),

  // Consistent with maintenance: resource owner or admin.
  "incident:resolve": (actor, s) => isAdmin(actor) || ownsResource(actor, s.resource),
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
 * The department analytics cover when the caller names none: their own, for
 * everyone - admins included. Unlike resource listings, an admin sees another
 * department's (or every department's) analytics only by asking for it.
 */
export function defaultAnalyticsScope(actor: Actor): AnalyticsSubject {
  return { departmentId: actor.departmentId };
}

/**
 * The bookings a listing may return (the list-level form of booking:view).
 * `mine` narrows to the actor's own bookings for everyone.
 */
export function bookingListScope(actor: Actor, opts: { mine: boolean }): BookingListScope {
  if (opts.mine) return { kind: "own", userId: actor.id };
  return isAdmin(actor) ? { kind: "all" } : { kind: "ownOrManaged", userId: actor.id };
}

/**
 * The approvals inbox: pending bookings on resources the actor owns; an
 * admin sees every pending booking in their own department. Whether the
 * actor may decide a given item is still `can(actor, "booking:approve", …)`.
 */
export function approvalInboxScope(actor: Actor): ApprovalInboxScope {
  return isAdmin(actor)
    ? { kind: "department", departmentId: actor.departmentId }
    : { kind: "ownedBy", userId: actor.id };
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

function bookingCreateDenial(actor: Actor, r: BookingCreateSubject): DomainError | null {
  const hidden = hiddenResource(actor, r);
  if (hidden) return hidden;
  // Visible (admins see all departments) but not bookable from here (§2c).
  if (r.departmentId !== actor.departmentId) {
    return new DomainError("WRONG_DEPARTMENT", "You can only book resources in your own department");
  }
  if (!r.isActive) return new DomainError("FORBIDDEN", "This resource is not accepting bookings");
  return null;
}

const denials: { [A in Action]?: Denial<A> } = {
  "resource:view": hiddenResource,
  "resource:manage": hiddenResource,
  "maintenance:create": hiddenResource,
  "maintenance:remove": hiddenResource,
  "incident:report": (actor, s) => {
    const hidden = hiddenResource(actor, s.resource);
    if (hidden) return hidden;
    if (s.bookingUserId !== null && s.bookingUserId !== actor.id) {
      return new DomainError("FORBIDDEN", "Only the resource's owners or an admin can report against someone else's booking");
    }
    return new DomainError("FORBIDDEN", "Only people who have booked this resource, its owners and admins can report incidents on it");
  },
  "incident:view": () => incidentNotFound(),
  "incident:resolve": (actor, s) => (can(actor, "incident:view", s) ? null : incidentNotFound()),
  "resource:manage_owners": hiddenResource,
  "booking:create": bookingCreateDenial,
  "waitlist:create": bookingCreateDenial,
  "series:create": bookingCreateDenial,
  // Someone else's entry is indistinguishable from a missing one.
  "waitlist:cancel": () => waitlistEntryNotFound(),
  "series:view": () => seriesNotFound(),
  "series:cancel": (actor, s) => (can(actor, "series:view", s) ? null : seriesNotFound()),
  "analytics:view": (actor, s) => {
    // A named resource outside the actor's departments doesn't exist for them.
    const hidden = hiddenResource(actor, s);
    if (hidden) return hidden;
    if (!ANALYTICS_ROLES.includes(actor.role)) {
      return new DomainError("FORBIDDEN", "Analytics are available to faculty, lab in-charges and admins");
    }
    // Department IDs are public, so another department is 403, not 404 (§2c).
    return new DomainError("FORBIDDEN", "You can only view analytics for your own department");
  },
  // A booking you may not see is indistinguishable from one that doesn't exist.
  "booking:view": () => bookingNotFound(),
  "booking:cancel": (actor, b) => (can(actor, "booking:view", b) ? null : bookingNotFound()),
  "checkin:override": (actor, b) => {
    if (!can(actor, "booking:view", b)) return bookingNotFound();
    if (b.resource.departmentId !== actor.departmentId) {
      return new DomainError("WRONG_DEPARTMENT", "You can only override check-ins in your own department");
    }
    if (b.userId === actor.id) {
      return new DomainError("FORBIDDEN", "You cannot override check-in on your own booking; scan the QR code instead");
    }
    return null;
  },
  "booking:approve": (actor, s) => {
    if (!can(actor, "booking:view", s)) return bookingNotFound();
    if (s.resource.departmentId !== actor.departmentId) {
      return new DomainError("WRONG_DEPARTMENT", "You can only decide bookings in your own department");
    }
    if (s.userId === actor.id) return new DomainError("FORBIDDEN", "You cannot approve or reject your own booking");
    if (s.deciderIds.includes(actor.id)) {
      return new DomainError(
        "FORBIDDEN",
        "You have already decided on this booking; a different approver must decide the next level",
      );
    }
    const ownsAnotherLevel = s.resource.owners.some((o) => o.userId === actor.id);
    if (ownsAnotherLevel && s.nextLevel !== null) {
      return new DomainError("FORBIDDEN", `This booking is awaiting level ${s.nextLevel} approval`);
    }
    return null;
  },
};

/** The error to raise after `can()` returned false. */
export function denial<A extends Action>(actor: Actor, action: A, subject: PolicySubjects[A]): DomainError {
  const specific: Denial<A> | undefined = denials[action];
  return specific?.(actor, subject) ?? new DomainError("FORBIDDEN", `You are not allowed to perform ${action}`);
}
