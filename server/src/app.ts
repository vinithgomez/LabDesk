import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "./config/env.js";
import type { Services } from "./container.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import type { Logger } from "./lib/logger.js";
import { authRouter } from "./routes/auth.routes.js";
import { departmentsRouter } from "./routes/departments.routes.js";
import { bookingsRouter } from "./routes/bookings.routes.js";
import { resourcesRouter } from "./routes/resources.routes.js";
import { usersRouter } from "./routes/users.routes.js";

export interface AppDeps {
  config: AppConfig;
  services: Services;
  logger: Logger;
}

export function createApp({ config, services, logger }: AppDeps): Express {
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
  app.use("/api/resources", resourcesRouter(services.auth, services.resources));
  app.use("/api/bookings", bookingsRouter(services.auth, services.bookings, services.resources));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
