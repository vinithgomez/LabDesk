import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveIcsTokenSecret, ICS_SECRET_LABEL, loadConfig } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "access-secret-0123456789",
  JWT_REFRESH_SECRET: "refresh-secret-0123456789",
};

// A spread of JWT secrets: short, long, hex-looking, the .env.example placeholder.
const JWT_SECRETS = [
  "change-me-access",
  "access-secret-0123456789",
  "a".repeat(64),
  createHmac("sha256", "x").update("y").digest("hex"),
  "ﬀ unicode 🔑 secret 0123456789",
];

describe("calendar-feed signing key", () => {
  it("when unset, is derived one-way: never byte-identical to the JWT secrets", () => {
    for (const secret of JWT_SECRETS) {
      const config = loadConfig({ ...base, JWT_ACCESS_SECRET: secret });
      const derived = Buffer.from(config.icsTokenSecret);
      expect(derived.equals(Buffer.from(secret))).toBe(false);
      expect(derived.equals(Buffer.from(config.jwtRefreshSecret))).toBe(false);
      // Not a trivial transformation of it either (e.g. the secret embedded).
      expect(config.icsTokenSecret.includes(secret)).toBe(false);
    }
  });

  it("is exactly HMAC-SHA256(JWT_ACCESS_SECRET, the purpose label), hex", () => {
    expect(ICS_SECRET_LABEL).toBe("labdesk:ics-token-secret");
    const expected = createHmac("sha256", base.JWT_ACCESS_SECRET).update(ICS_SECRET_LABEL).digest("hex");
    expect(loadConfig(base).icsTokenSecret).toBe(expected);
    expect(deriveIcsTokenSecret(base.JWT_ACCESS_SECRET)).toBe(expected);
    // Stable for a given secret, different for another.
    expect(deriveIcsTokenSecret(base.JWT_ACCESS_SECRET)).toBe(expected);
    expect(deriveIcsTokenSecret("another-secret-0123456789")).not.toBe(expected);
  });

  it("can never equal an HS256 signature the server issues", () => {
    // JWT signing inputs are "<base64url>.<base64url>"; the label is not one.
    expect(ICS_SECRET_LABEL).toMatch(/[^A-Za-z0-9_.-]/);
  });

  it("uses an explicit ICS_TOKEN_SECRET as is, but refuses literal reuse of a JWT secret", () => {
    expect(loadConfig({ ...base, ICS_TOKEN_SECRET: "calendar-secret-0123456789" }).icsTokenSecret).toBe(
      "calendar-secret-0123456789",
    );
    for (const reused of [base.JWT_ACCESS_SECRET, base.JWT_REFRESH_SECRET]) {
      expect(() => loadConfig({ ...base, ICS_TOKEN_SECRET: reused })).toThrow(/ICS_TOKEN_SECRET must differ/);
    }
  });
});
