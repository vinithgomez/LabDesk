import { describe, expect, it } from "vitest";
import { checkinUrl, signResourceQr, verifyResourceQr } from "./qr-signature.js";

const SECRET = "a".repeat(64);
const RESOURCE = "7f1e4c2a-9b3d-4e5f-8a6b-1c2d3e4f5a6b";

describe("resource QR signature", () => {
  it("verifies its own signature and is deterministic (printable for the resource's lifetime)", () => {
    const sig = signResourceQr(SECRET, RESOURCE);
    expect(signResourceQr(SECRET, RESOURCE)).toBe(sig);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url HMAC-SHA256
    expect(verifyResourceQr(SECRET, RESOURCE, sig)).toBe(true);
  });

  it("rejects a tampered signature, another resource's signature and another secret", () => {
    const sig = signResourceQr(SECRET, RESOURCE);
    const tampered = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyResourceQr(SECRET, RESOURCE, tampered)).toBe(false);

    const otherResource = "0b0e8d3a-1111-4222-8333-444455556666";
    expect(verifyResourceQr(SECRET, otherResource, sig)).toBe(false);
    expect(verifyResourceQr("b".repeat(64), RESOURCE, sig)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyResourceQr(SECRET, RESOURCE, "")).toBe(false);
    expect(verifyResourceQr(SECRET, RESOURCE, "short")).toBe(false);
    expect(verifyResourceQr(SECRET, RESOURCE, "x".repeat(200))).toBe(false);
  });

  it("encodes the §7 check-in URL", () => {
    expect(checkinUrl("https://labdesk.test", RESOURCE, "abc")).toBe(`https://labdesk.test/checkin?r=${RESOURCE}&sig=abc`);
  });
});
