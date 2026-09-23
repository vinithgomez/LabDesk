import { describe, expect, it } from "vitest";
import { toAuditSnapshot } from "./audit.js";

describe("toAuditSnapshot", () => {
  it("drops password, secret and token keys at any depth", () => {
    const snapshot = toAuditSnapshot({
      id: "r-1",
      passwordHash: "$2b$hash",
      password_hash: "$2b$hash",
      qrSecret: "abc",
      nested: { qr_secret: "abc", keep: 1, list: [{ refreshToken: "t", ok: true }] },
    });
    expect(snapshot).toEqual({ id: "r-1", nested: { keep: 1, list: [{ ok: true }] } });
  });

  it("serialises dates to ISO strings and preserves null", () => {
    const at = new Date("2026-09-23T10:00:00.000Z");
    expect(toAuditSnapshot({ at, rollNo: null })).toEqual({ at: "2026-09-23T10:00:00.000Z", rollNo: null });
    expect(toAuditSnapshot(null)).toBeNull();
  });
});
