import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "./config/env.js";
import type { Services } from "./container.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { createFixedWindowLimiter } from "./http/rate-limit.js";
import type { Logger } from "./lib/logger.js";
import type { Redis } from "./lib/redis.js";
import { analyticsRouter } from "./routes/analytics.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { departmentsRouter } from "./routes/departments.routes.js";
import { bookingsRouter } from "./routes/bookings.routes.js";
import { checkinRouter } from "./routes/checkin.routes.js";
import { resourcesRouter } from "./routes/resources.routes.js";
import { seriesRouter } from "./routes/series.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { waitlistRouter } from "./routes/waitlist.routes.js";

export interface AppDeps {
  config: AppConfig;
  services: Services;
  logger: Logger;
  redis: Redis;
}

/** §7: at most 5 scans per user per resource per minute. */
export const SCAN_RATE_LIMIT = { limit: 5, windowMs: 60_000 } as const;

export function createApp({ config, services, logger, redis }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(pinoHttp({ logger }));
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const isProd = config.nodeEnv === "production";
  // Frontend and API are on different sites in production (Vercel vs
  // Railway/Render), which requires SameSite=None; Secure for the cookie.
  const cookie = { secure: isProd, sameSite: isProd ? "none" : "lax" } as const;

  app.get("/api/health", (_req, res) => {
    res.json({ data: { status: "ok" } });
  });
  app.use("/api/auth", authRouter(services.auth, cookie));
  app.use("/api/departments", departmentsRouter(services.departments));
  app.use("/api/users", usersRouter(services.auth, services.users));
  app.use("/api/resources", resourcesRouter(services.auth, services.resources, services.bookings, services.checkins));
  app.use("/api/bookings", bookingsRouter(services.auth, services.bookings, services.resources));
  app.use(
    "/api/checkin",
    checkinRouter(
      services.auth,
      services.checkins,
      services.bookings,
      createFixedWindowLimiter(redis, { prefix: "ratelimit:checkin", ...SCAN_RATE_LIMIT }),
    ),
  );

  app.use("/api/waitlist", waitlistRouter(services.auth, services.waitlist, services.resources));
  app.use("/api/series", seriesRouter(services.auth, services.series, services.resources));
  app.use("/api/analytics", analyticsRouter(services.auth, services.analytics, services.resources));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
