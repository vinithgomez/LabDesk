import { ApiError } from "./api";

/**
 * One human sentence for every error code the API (or this client) can
 * produce. The single place error codes become words: screens call
 * describeApiError() rather than showing codes or raw server messages.
 *
 * Where a rule has a limit, the sentence states it, taken from the resource
 * involved when the caller passes it (the API's error body carries the rule,
 * the resource carries the numbers).
 */

export interface ErrorContext {
  /** The resource the request was about, for its name and limits. */
  resource?: {
    name: string;
    capacity: number;
    minSlotMinutes: number;
    maxSlotMinutes: number;
    bookingHorizonDays: number;
  };
  /** The period that was attempted, to tell "in the past" from "too far ahead". */
  period?: { start: Date; end: Date };
  now?: Date;
  /**
   * An approve/reject decision. The server reports every approval refusal as
   * FORBIDDEN or INVALID_TRANSITION, so the item itself says which case it was.
   */
  approval?: ApprovalErrorContext;
  /** A role change: whose role was being changed. */
  roleChange?: { ownAccount: boolean };
}

export interface ApprovalErrorContext {
  action: "approve" | "reject";
  /** The caller booked it. */
  ownBooking: boolean;
  /** The caller already decided an earlier level of it. */
  decidedEarlierLevel: boolean;
  /** The level waiting for a decision when the caller acted. */
  awaitingLevel: number | null;
  /** Its start time has passed. */
  lapsed: boolean;
}

export const API_ERROR_CODES = [
  // Server: domain errors (server/src/domain/errors.ts)
  "VALIDATION_ERROR",
  "INVALID_CREDENTIALS",
  "ACCOUNT_DISABLED",
  "UNAUTHENTICATED",
  "INVALID_REFRESH_TOKEN",
  "REFRESH_TOKEN_REUSED",
  "EMAIL_TAKEN",
  "DEPARTMENT_NOT_FOUND",
  "USER_NOT_FOUND",
  "INVALID_OWNER",
  "INVALID_SLOT_BOUNDS",
  "FORBIDDEN",
  "WRONG_DEPARTMENT",
  "NOT_FOUND",
  "SLOT_CONFLICT",
  "MAINTENANCE_BLOCKED",
  "MULTI_DAY_NOT_SUPPORTED",
  "SLOT_TOO_LONG",
  "SLOT_TOO_SHORT",
  "OUTSIDE_HORIZON",
  "CAPACITY_EXCEEDED",
  "IDEMPOTENCY_KEY_REUSED",
  "INVALID_TRANSITION",
  "OWNER_REQUIRED",
  "INVALID_QR",
  "NO_ACTIVE_BOOKING",
  "RATE_LIMITED",
  "SLOT_AVAILABLE",
  "WAITLIST_DUPLICATE",
  "INVALID_RRULE",
  "INVALID_BUSINESS_HOURS",
  "MAINTENANCE_OVERLAP",
  // Server: HTTP layer (server/src/http/errors.ts)
  "INVALID_JSON",
  "INTERNAL_ERROR",
  // This client (src/lib/api.ts)
  "NETWORK",
  "HTTP_ERROR",
  "BAD_RESPONSE",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** "30 minutes", "1 hour", "3 hours", "1 h 30 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h} h ${m} min`;
}

const the = (ctx: ErrorContext): string => ctx.resource?.name ?? "This resource";

/** The first field-level problem a VALIDATION_ERROR carries, if any. */
function firstDetail(err: ApiError): string | null {
  const details = err.details;
  if (!Array.isArray(details) || details.length === 0) return null;
  const first: unknown = details[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return null;
  const path = "path" in first && typeof first.path === "string" && first.path ? `${first.path}: ` : "";
  return typeof first.message === "string" ? `${path}${first.message}` : null;
}

const SENTENCES: Record<ApiErrorCode, (err: ApiError, ctx: ErrorContext) => string> = {
  VALIDATION_ERROR: (err) => {
    const detail = firstDetail(err);
    return detail ? `Some details weren't accepted (${detail}).` : "Some details weren't accepted; check the form and try again.";
  },
  INVALID_CREDENTIALS: () => "That email and password don't match an account.",
  ACCOUNT_DISABLED: () => "This account has been deactivated; ask an admin to reactivate it.",
  UNAUTHENTICATED: () => "Your session has ended; sign in again.",
  INVALID_REFRESH_TOKEN: () => "Your session has ended; sign in again.",
  REFRESH_TOKEN_REUSED: () => "For your security you were signed out everywhere; sign in again.",
  EMAIL_TAKEN: () => "An account with that email already exists; sign in instead.",
  DEPARTMENT_NOT_FOUND: () => "That department doesn't exist; choose one from the list.",
  USER_NOT_FOUND: () => "That user doesn't exist.",
  INVALID_OWNER: (err) => {
    const reason = firstOwnerProblem(err);
    return reason
      ? `One of the chosen owners can't own this resource: ${reason}. Owners must be active staff in the resource's department, or admins.`
      : "One of the chosen owners can't own this resource. Owners must be active staff in the resource's department, or admins, and each person may appear once.";
  },
  INVALID_SLOT_BOUNDS: () => "The minimum booking length can't be longer than the maximum.",
  FORBIDDEN: () => "You're not allowed to do that.",
  WRONG_DEPARTMENT: (_err, ctx) =>
    `${the(ctx)} belongs to another department; you can only book resources in your own department.`,
  NOT_FOUND: () => "That doesn't exist, or you don't have access to it.",
  SLOT_CONFLICT: () =>
    "Someone else has just booked part of that time; the calendar now shows their booking, so pick another time or join the waitlist.",
  MAINTENANCE_BLOCKED: (_err, ctx) => `${the(ctx)} is closed for maintenance during that time.`,
  MULTI_DAY_NOT_SUPPORTED: () => "A booking has to start and end on the same day (India time).",
  SLOT_TOO_LONG: (err, ctx) =>
    ctx.resource
      ? `That's too long: ${ctx.resource.name} can be booked for at most ${formatDuration(ctx.resource.maxSlotMinutes)} at a time.`
      : `That's too long: ${err.message}.`,
  SLOT_TOO_SHORT: (err, ctx) =>
    ctx.resource
      ? `That's too short: ${ctx.resource.name} must be booked for at least ${formatDuration(ctx.resource.minSlotMinutes)}.`
      : `That's too short: ${err.message}.`,
  OUTSIDE_HORIZON: (err, ctx) => {
    const now = ctx.now ?? new Date();
    if (ctx.period && ctx.period.start.getTime() < now.getTime()) {
      return "That time has already started; bookings can't begin in the past.";
    }
    return ctx.resource
      ? `That's too far ahead: ${ctx.resource.name} can only be booked up to ${ctx.resource.bookingHorizonDays} days in advance.`
      : `That's outside the booking window: ${err.message}.`;
  },
  CAPACITY_EXCEEDED: (err, ctx) =>
    ctx.resource
      ? `Too many people: ${ctx.resource.name} holds at most ${ctx.resource.capacity}.`
      : `Too many people: ${err.message}.`,
  IDEMPOTENCY_KEY_REUSED: () => "That request clashed with an earlier one; submit it again.",
  INVALID_TRANSITION: () => "That can't be done in the booking's current state; refresh and try again.",
  OWNER_REQUIRED: () =>
    "A resource that needs approval must have at least one owner at each approval level it uses: add a level 1 owner, and a level 2 owner if it uses two levels.",
  INVALID_QR: () => "That isn't a valid LabDesk check-in code.",
  NO_ACTIVE_BOOKING: () => "You have no booking on this resource right now.",
  RATE_LIMITED: () => "Too many attempts; wait a minute, then try again.",
  SLOT_AVAILABLE: () => "That time is free now, so you can book it directly instead of joining the waitlist.",
  WAITLIST_DUPLICATE: () => "You're already on the waitlist for an overlapping time.",
  INVALID_RRULE: () =>
    "That repeat pattern can't be used: choose at least one weekday and an end date late enough to include another occurrence.",
  INVALID_BUSINESS_HOURS: () => "The opening time must be earlier than the closing time.",
  MAINTENANCE_OVERLAP: () => "Maintenance is already scheduled during part of that time.",
  INVALID_JSON: () => "The request couldn't be read; try again.",
  INTERNAL_ERROR: () => "Something went wrong on the server; try again.",
  NETWORK: () => "Couldn't reach LabDesk; check your connection and try again.",
  HTTP_ERROR: (err) => `Something went wrong (HTTP ${err.status}); try again.`,
  BAD_RESPONSE: () => "LabDesk sent an unexpected response; try again.",
};

const isKnown = (code: string): code is ApiErrorCode => (API_ERROR_CODES as readonly string[]).includes(code);

/** The reason the server gave for the first ineligible owner (INVALID_OWNER details). */
function firstOwnerProblem(err: ApiError): string | null {
  const details = err.details;
  if (!Array.isArray(details) || details.length === 0) return null;
  const first: unknown = details[0];
  return typeof first === "object" && first !== null && "reason" in first && typeof first.reason === "string"
    ? first.reason
    : null;
}

/** Approval refusals, told apart by the item the caller acted on. */
function approvalSentence(err: ApiError, a: ApprovalErrorContext): string | null {
  switch (err.code) {
    case "FORBIDDEN":
      if (a.ownBooking) return "You can't approve or reject your own booking.";
      if (a.decidedEarlierLevel) {
        return `You already decided an earlier level of this booking; a different approver must decide level ${a.awaitingLevel ?? "the next level"}.`;
      }
      return a.awaitingLevel !== null
        ? `This booking is awaiting level ${a.awaitingLevel} approval, which isn't yours to decide.`
        : "You aren't allowed to decide this booking.";
    case "INVALID_TRANSITION":
      if (a.action === "approve" && a.lapsed) {
        return "Approval is closed: the booking's start time has passed, so it can only be rejected.";
      }
      return "This booking was already decided by someone else, or cancelled, before your decision arrived.";
    case "WRONG_DEPARTMENT":
      return "You can only decide bookings in your own department.";
    case "NOT_FOUND":
      return "This booking is no longer in your inbox; it may have been cancelled.";
    default:
      return null;
  }
}

/** The sentence for any error a request produced. */
export function describeApiError(err: unknown, ctx: ErrorContext = {}): string {
  if (!(err instanceof ApiError)) return "Something went wrong; try again.";
  if (ctx.approval) {
    const sentence = approvalSentence(err, ctx.approval);
    if (sentence) return sentence;
  }
  if (ctx.roleChange && err.code === "FORBIDDEN") {
    return ctx.roleChange.ownAccount
      ? "You can't change your own role; another admin has to do it."
      : "Only admins can change roles.";
  }
  if (isKnown(err.code)) return SENTENCES[err.code](err, ctx);
  // A code this client doesn't know yet: the server's own message is the best we have.
  return err.message;
}

/**
 * Why a series occurrence was skipped. The series detail records the domain
 * error code that refused that one booking (GET /api/series/:id skipped[]).
 */
export function describeSkipReason(code: string): string {
  switch (code) {
    case "SLOT_CONFLICT":
      return "Someone else already had that time booked.";
    case "MAINTENANCE_BLOCKED":
      return "The resource was closed for maintenance then.";
    case "OUTSIDE_HORIZON":
      return "It was outside the resource's booking window.";
    case "SLOT_TOO_LONG":
    case "SLOT_TOO_SHORT":
      return "Its length no longer fits the resource's booking limits.";
    case "MULTI_DAY_NOT_SUPPORTED":
      return "It would have run past midnight (India time).";
    case "CAPACITY_EXCEEDED":
      return "It had more attendees than the resource holds.";
    case "FORBIDDEN":
    case "WRONG_DEPARTMENT":
      return "The resource wasn't accepting bookings from you then.";
    default:
      return "It couldn't be booked.";
  }
}
