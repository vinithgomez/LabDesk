import { describe, expect, it } from "vitest";
import { readIcsToken, signIcsToken } from "./ics-token.js";

const SECRET = "test-ics-secret-0123456789";
const USER = "3f2b8c1e-5d6a-4b7c-8e9f-0a1b2c3d4e5f";

describe("ICS feed tokens", () => {
  it("round-trips the user and version, and is URL-safe", () => {
    const token = signIcsToken(SECRET, USER, 3);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readIcsToken(SECRET, token)).toEqual({ userId: USER, version: 3 });
  });

  it("is stable for a version and changes when the version changes", () => {
    expect(signIcsToken(SECRET, USER, 1)).toBe(signIcsToken(SECRET, USER, 1));
    expect(signIcsToken(SECRET, USER, 2)).not.toBe(signIcsToken(SECRET, USER, 1));
  });

  it("rejects tampering, another secret, and junk", () => {
    const token = signIcsToken(SECRET, USER, 1);
    const raw = Buffer.from(token, "base64url");
    raw.writeUInt32BE(2, 16); // claim a different version without re-signing
    expect(readIcsToken(SECRET, raw.toString("base64url"))).toBeNull();
    expect(readIcsToken("another-secret-0123456789", token)).toBeNull();
    expect(readIcsToken(SECRET, token.slice(0, -2))).toBeNull();
    expect(readIcsToken(SECRET, "not a token")).toBeNull();
    expect(readIcsToken(SECRET, "")).toBeNull();
  });

  it("accepts only the canonical spelling of a token", () => {
    const token = signIcsToken(SECRET, USER, 1);
    // 52 bytes -> 70 base64url characters; only the top 2 of the last
    // character's 6 bits are data, so flipping its lowest bit changes nothing
    // once decoded.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const index = alphabet.indexOf(token.at(-1) ?? "");
    const alias = token.slice(0, -1) + alphabet.charAt(index ^ 1);
    expect(alias).not.toBe(token);
    expect(Buffer.from(alias, "base64url")).toEqual(Buffer.from(token, "base64url"));
    expect(readIcsToken(SECRET, alias)).toBeNull();
  });

  it("can't be derived from the user id alone", () => {
    // Same id and version under a different key: nothing in common but the payload.
    const a = Buffer.from(signIcsToken(SECRET, USER, 1), "base64url");
    const b = Buffer.from(signIcsToken("different-secret-0123456789", USER, 1), "base64url");
    expect(a.subarray(0, 20)).toEqual(b.subarray(0, 20));
    expect(a.subarray(20)).not.toEqual(b.subarray(20));
  });
});
