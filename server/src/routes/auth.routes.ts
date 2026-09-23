import { Router, type CookieOptions, type Response } from "express";
import { z } from "zod";
import { requireAuth, actorOf } from "../http/authenticate.js";
import { respond } from "../http/respond.js";
import type { AuthService, Session } from "../services/auth.service.js";
import { userWithDepartmentDto } from "./schemas.js";

export const REFRESH_COOKIE = "labdesk_rt";

// Request schemas are strict: unknown keys (e.g. a smuggled `role`) are rejected.
export const registerBody = z.strictObject({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  // bcrypt only uses the first 72 bytes; cap it so users aren't misled.
  password: z.string().min(8).max(72),
  fullName: z.string().trim().min(1).max(120),
  departmentId: z.uuid(),
  rollNo: z.string().trim().min(1).max(32).optional(),
});

export const loginBody = z.strictObject({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(72),
});

export const sessionDto = z.object({
  accessToken: z.string(),
  user: userWithDepartmentDto,
});

export type RegisterBody = z.input<typeof registerBody>;
export type LoginBody = z.input<typeof loginBody>;
export type SessionDto = z.output<typeof sessionDto>;

export interface CookieSettings {
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
}

export function authRouter(auth: AuthService, cookie: CookieSettings): Router {
  const router = Router();

  const cookieOptions = (): CookieOptions => ({
    httpOnly: true,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: "/api/auth",
  });

  const sendSession = (res: Response, status: number, session: Session): void => {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...cookieOptions(),
      expires: session.refreshExpiresAt,
    });
    respond(res, status, sessionDto, { accessToken: session.accessToken, user: session.user });
  };

  const readRefreshCookie = (cookies: unknown): string | undefined => {
    const parsed = z.object({ [REFRESH_COOKIE]: z.string().min(1) }).safeParse(cookies);
    return parsed.success ? parsed.data[REFRESH_COOKIE] : undefined;
  };

  router.post("/register", async (req, res) => {
    const body = registerBody.parse(req.body);
    sendSession(res, 201, await auth.register(body));
  });

  router.post("/login", async (req, res) => {
    const body = loginBody.parse(req.body);
    sendSession(res, 200, await auth.login(body.email, body.password));
  });

  router.post("/refresh", async (req, res) => {
    const token = readRefreshCookie(req.cookies);
    try {
      sendSession(res, 200, await auth.refresh(token ?? ""));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions());
      throw err;
    }
  });

  router.post("/logout", async (req, res) => {
    await auth.logout(readRefreshCookie(req.cookies));
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    respond(res, 200, z.object({ loggedOut: z.literal(true) }), { loggedOut: true });
  });

  router.get("/me", requireAuth(auth), async (req, res) => {
    respond(res, 200, userWithDepartmentDto, await auth.me(actorOf(req)));
  });

  return router;
}
