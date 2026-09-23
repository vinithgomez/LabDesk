import type { Request, RequestHandler } from "express";
import { DomainError } from "../domain/errors.js";
import type { Actor } from "../domain/types.js";
import type { AuthService } from "../services/auth.service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

/** Requires `Authorization: Bearer <access token>` and attaches the actor. */
export function requireAuth(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
    if (!match?.[1]) {
      throw new DomainError("UNAUTHENTICATED", "Missing bearer access token");
    }
    req.actor = await auth.authenticate(match[1]);
    next();
  };
}

/** Reads the actor set by requireAuth; throws if the route wasn't protected. */
export function actorOf(req: Request): Actor {
  if (!req.actor) throw new DomainError("UNAUTHENTICATED", "Authentication required");
  return req.actor;
}
