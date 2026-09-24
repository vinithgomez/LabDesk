import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { DomainError, type DomainErrorCode } from "../domain/errors.js";
import type { Logger } from "../lib/logger.js";

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  INVALID_REFRESH_TOKEN: 401,
  REFRESH_TOKEN_REUSED: 401,
  ACCOUNT_DISABLED: 403,
  FORBIDDEN: 403,
  WRONG_DEPARTMENT: 403,
  USER_NOT_FOUND: 404,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  SLOT_CONFLICT: 409,
  MAINTENANCE_BLOCKED: 409,
  INVALID_TRANSITION: 409,
  MULTI_DAY_NOT_SUPPORTED: 422,
  SLOT_TOO_LONG: 422,
  SLOT_TOO_SHORT: 422,
  OUTSIDE_HORIZON: 422,
  CAPACITY_EXCEEDED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  OWNER_REQUIRED: 422,
  INVALID_QR: 422,
  NO_ACTIVE_BOOKING: 404,
  RATE_LIMITED: 429,
  DEPARTMENT_NOT_FOUND: 422,
  INVALID_OWNER: 422,
  INVALID_SLOT_BOUNDS: 422,
};

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function body(code: string, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

function isBodyParseError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "type" in err && err.type === "entity.parse.failed";
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(body("NOT_FOUND", "Route not found"));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    if (err instanceof DomainError) {
      res.status(STATUS_BY_CODE[err.code]).json(body(err.code, err.message, err.details));
      return;
    }
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      res.status(400).json(body("VALIDATION_ERROR", "Request validation failed", details));
      return;
    }
    if (isBodyParseError(err)) {
      res.status(400).json(body("INVALID_JSON", "Request body is not valid JSON"));
      return;
    }
    logger.error({ err }, "unhandled error");
    res.status(500).json(body("INTERNAL_ERROR", "Something went wrong"));
  };
}
