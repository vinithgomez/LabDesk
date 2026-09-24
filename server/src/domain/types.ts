export const USER_ROLES = ["student", "faculty", "lab_incharge", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const RESOURCE_TYPES = ["lab", "room", "equipment"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** The authenticated principal every policy decision is made about. */
export interface Actor {
  id: string;
  role: UserRole;
  departmentId: string;
  isActive: boolean;
}

export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  departmentId: string;
  rollNo: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface UserWithDepartment extends User {
  department: Department;
}

/** Credentials are only ever loaded by the auth service for verification. */
export interface UserCredentials extends User {
  passwordHash: string;
}

/** A resource owner and the approval level they decide at. */
export interface ResourceOwner {
  userId: string;
  approvalLevel: number;
}

export interface Resource {
  id: string;
  departmentId: string;
  name: string;
  type: ResourceType;
  location: string;
  capacity: number;
  description: string;
  requiresApproval: boolean;
  approvalLevels: number;
  minSlotMinutes: number;
  maxSlotMinutes: number;
  bookingHorizonDays: number;
  isActive: boolean;
  /** Derived from `owners`; what most authorization checks need. */
  ownerIds: string[];
  owners: ResourceOwner[];
  createdAt: Date;
  updatedAt: Date;
}

export const BOOKING_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "checked_in",
  "completed",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses that hold a slot (they participate in the overlap constraint). */
export const SLOT_HOLDING_STATUSES = ["pending", "approved", "checked_in"] as const satisfies readonly BookingStatus[];

/**
 * Which bookings a listing may return. Computed only by the policy module
 * (`bookingListScope`).
 */
export type BookingListScope =
  | { kind: "all" }
  | { kind: "own"; userId: string }
  /** The user's own bookings plus bookings on resources they own. */
  | { kind: "ownOrManaged"; userId: string };

/**
 * Which pending bookings an approvals inbox shows. Computed only by the
 * policy module (`approvalInboxScope`).
 */
export type ApprovalInboxScope =
  | { kind: "department"; departmentId: string }
  | { kind: "ownedBy"; userId: string };

/** `period` is the half-open range [startsAt, endsAt), stored as tstzrange in UTC. */
export interface Booking {
  id: string;
  resourceId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  purpose: string;
  attendeeCount: number;
  seriesId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** One approval decision on a booking (CLAUDE.md §4 booking_approvals). */
export interface BookingApproval {
  id: string;
  bookingId: string;
  level: number;
  approverId: string;
  decision: ApprovalDecision;
  comment: string;
  decidedAt: Date;
}

export const CHECKIN_METHODS = ["qr", "manual_override"] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];
export const CHECKOUT_METHODS = ["qr", "manual_override", "auto"] as const;
export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number];

/** Actual usage of a booking (CLAUDE.md §4 checkins). */
export interface Checkin {
  id: string;
  bookingId: string;
  checkedInAt: Date;
  checkedOutAt: Date | null;
  checkinMethod: CheckinMethod;
  overriddenBy: string | null;
  checkoutMethod: CheckoutMethod | null;
  checkoutOverriddenBy: string | null;
}

export const WAITLIST_STATUSES = ["waiting", "promoted", "expired", "cancelled"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

/**
 * A request to be booked into a held slot if it frees (CLAUDE.md §4
 * waitlist_entries). `desired_period` is [startsAt, endsAt). `bookingId` is
 * the booking a promoted entry became.
 */
export interface WaitlistEntry {
  id: string;
  resourceId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  purpose: string;
  attendeeCount: number;
  status: WaitlistStatus;
  bookingId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const SERIES_STATUSES = ["active", "cancelled"] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];

/** A recurring booking (CLAUDE.md §4 booking_series). */
export interface BookingSeries {
  id: string;
  resourceId: string;
  userId: string;
  /** Normalized RFC 5545 subset: FREQ=WEEKLY;BYDAY=...;UNTIL=... */
  rrule: string;
  /** IST wall-clock start, "HH:MM". */
  startTime: string;
  durationMinutes: number;
  purpose: string;
  attendeeCount: number;
  status: SeriesStatus;
  /** Start of the last occurrence the materializer processed (booked or skipped). */
  materializedThrough: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

/** An occurrence the materializer could not book, and why (a DomainError code). */
export interface SeriesSkip {
  id: string;
  seriesId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  message: string;
  createdAt: Date;
}
