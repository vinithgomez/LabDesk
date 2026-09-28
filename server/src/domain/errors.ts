/**
 * Domain-level error codes. Services throw DomainError; the HTTP layer
 * (src/http/errors.ts) is the only place that maps codes to status codes.
 */
export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_DISABLED"
  | "UNAUTHENTICATED"
  | "INVALID_REFRESH_TOKEN"
  | "REFRESH_TOKEN_REUSED"
  | "EMAIL_TAKEN"
  | "DEPARTMENT_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "INVALID_OWNER"
  | "INVALID_SLOT_BOUNDS"
  | "FORBIDDEN"
  /** Reserved for a later phase: visible resource, action not permitted. Not returned by any current route. */
  | "WRONG_DEPARTMENT"
  | "NOT_FOUND"
  | "SLOT_CONFLICT"
  | "MAINTENANCE_BLOCKED"
  | "MULTI_DAY_NOT_SUPPORTED"
  | "SLOT_TOO_LONG"
  | "SLOT_TOO_SHORT"
  | "OUTSIDE_HORIZON"
  | "CAPACITY_EXCEEDED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_TRANSITION"
  | "OWNER_REQUIRED"
  | "INVALID_QR"
  | "NO_ACTIVE_BOOKING"
  | "RATE_LIMITED"
  /** Waitlist join for a slot nobody holds: book it directly instead. */
  | "SLOT_AVAILABLE"
  /** The user already has a waiting entry overlapping this period on this resource. */
  | "WAITLIST_DUPLICATE"
  | "INVALID_RRULE"
  /** Business hours must open before they close (no wrap past midnight). */
  | "INVALID_BUSINESS_HOURS"
  /** A resource's live maintenance windows may not overlap each other. */
  | "MAINTENANCE_OVERLAP";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * The one error for "no such resource" — used both when the row is missing
 * and when it exists in a department the actor cannot see, so the two cases
 * are indistinguishable to the client (CLAUDE.md §2c).
 */
export function resourceNotFound(): DomainError {
  return new DomainError("NOT_FOUND", "Resource not found");
}

/** Same rule for bookings: missing and not-visible-to-you look identical. */
export function bookingNotFound(): DomainError {
  return new DomainError("NOT_FOUND", "Booking not found");
}

/** Waitlist entries are private to their owner; anyone else's looks missing. */
export function waitlistEntryNotFound(): DomainError {
  return new DomainError("NOT_FOUND", "Waitlist entry not found");
}

export function maintenanceNotFound(): DomainError {
  return new DomainError("NOT_FOUND", "Maintenance window not found");
}

export function incidentNotFound(): DomainError {
  return new DomainError("NOT_FOUND", "Incident not found");
}

export function seriesNotFound(): DomainError {
  return new DomainError("NOT_FOUND", "Series not found");
}
