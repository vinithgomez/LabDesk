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
  | "RESOURCE_NOT_FOUND"
  | "INVALID_OWNER"
  | "INVALID_SLOT_BOUNDS"
  | "FORBIDDEN"
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
