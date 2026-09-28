import { createHmac } from "node:crypto";
import { z } from "zod";

/** Parses durations like "15m", "7d", "3600s" into whole seconds. */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}" (expected e.g. 15m, 7d)`);
  }
  const amount = Number(match[1]);
  const unitSeconds = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] as "s" | "m" | "h" | "d"];
  return amount * unitSeconds;
}

const duration = z.string().transform((value, ctx) => {
  try {
    return parseDurationSeconds(value);
  } catch (err) {
    ctx.addIssue({ code: "custom", message: (err as Error).message });
    return z.NEVER;
  }
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: duration.default(15 * 60),
  REFRESH_TOKEN_TTL: duration.default(7 * 86_400),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  REDIS_URL: z.string().min(1),
  // Base URL of the PWA, printed into resource QR codes. Changing it
  // invalidates every printed QR, so treat it as fixed per deployment.
  PUBLIC_APP_URL: z.url().default("http://localhost:5173"),
  // Base URL calendar apps use to reach the API; defaults to PUBLIC_APP_URL
  // (the frontend proxies /api). Set it when the API lives elsewhere.
  PUBLIC_API_URL: z.url().optional(),
  // Signs calendar-feed tokens. Optional: when unset it is derived one-way
  // from JWT_ACCESS_SECRET (see deriveIcsTokenSecret). Changing it (or that
  // secret, when derived) revokes every feed URL.
  ICS_TOKEN_SECRET: z.string().min(16).optional(),
  // Scheduled jobs (no-show sweeper, auto-complete, lapsed-pending expiry).
  JOBS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  corsOrigin: string;
  bcryptRounds: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  redisUrl: string;
  publicAppUrl: string;
  /** Where calendar apps fetch feeds from (no trailing slash). */
  publicApiUrl: string;
  icsTokenSecret: string;
  jobsEnabled: boolean;
}

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

/** Purpose label for the derived calendar-feed key. A different purpose must use a different label. */
export const ICS_SECRET_LABEL = "labdesk:ics-token-secret";

/**
 * The calendar-feed signing key when ICS_TOKEN_SECRET isn't set:
 *
 *   HMAC-SHA256(key = JWT_ACCESS_SECRET, message = ICS_SECRET_LABEL), hex-encoded
 *
 * - One-way: HMAC is a pseudorandom function, so the derived key reveals
 *   nothing about the JWT secret. A leaked feed-signing key is no path to
 *   forging access tokens.
 * - Purpose-bound: the fixed label ties it to calendar feeds only; any other
 *   key derived from the same secret must use a different label.
 * - Never a JWT signature: access tokens are HS256, i.e. the same HMAC under
 *   the same key, but over "<base64url header>.<base64url payload>". The label
 *   contains ":", which base64url never does, so no token the server issues
 *   can equal, or disclose, this key.
 *
 * Set ICS_TOKEN_SECRET explicitly in production to decouple the two entirely
 * (rotating the JWT secret then leaves feed URLs alone).
 */
export function deriveIcsTokenSecret(jwtAccessSecret: string): string {
  return createHmac("sha256", jwtAccessSecret).update(ICS_SECRET_LABEL).digest("hex");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const e = parsed.data;
  // An explicit ICS_TOKEN_SECRET must not literally reuse a JWT secret: one
  // scheme's key must never be the other's.
  if (e.ICS_TOKEN_SECRET !== undefined && [e.JWT_ACCESS_SECRET, e.JWT_REFRESH_SECRET].includes(e.ICS_TOKEN_SECRET)) {
    throw new Error("Invalid environment configuration: ICS_TOKEN_SECRET must differ from JWT_ACCESS_SECRET and JWT_REFRESH_SECRET");
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    jwtAccessSecret: e.JWT_ACCESS_SECRET,
    jwtRefreshSecret: e.JWT_REFRESH_SECRET,
    accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL,
    refreshTokenTtlSeconds: e.REFRESH_TOKEN_TTL,
    corsOrigin: e.CORS_ORIGIN,
    bcryptRounds: e.BCRYPT_ROUNDS,
    logLevel: e.LOG_LEVEL,
    redisUrl: e.REDIS_URL,
    publicAppUrl: e.PUBLIC_APP_URL.replace(/\/+$/, ""),
    publicApiUrl: trimSlash(e.PUBLIC_API_URL ?? e.PUBLIC_APP_URL),
    icsTokenSecret: e.ICS_TOKEN_SECRET ?? deriveIcsTokenSecret(e.JWT_ACCESS_SECRET),
    jobsEnabled: e.JOBS_ENABLED,
  };
}
