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
  | "NOT_FOUND";

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
