/**
 * Printed resource QR codes (CLAUDE.md §7). The QR encodes a check-in URL
 * carrying the resource id and an HMAC of `{resourceId, v:1}` keyed by the
 * resource's qr_secret. The signature is deterministic and the secret never
 * rotates, so one printed code works for the resource's whole lifetime.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const QR_PAYLOAD_VERSION = 1;

/** Fixed key order, so the signed bytes are canonical. */
function canonicalPayload(resourceId: string): string {
  return JSON.stringify({ resourceId, v: QR_PAYLOAD_VERSION });
}

export function signResourceQr(qrSecret: string, resourceId: string): string {
  return createHmac("sha256", qrSecret).update(canonicalPayload(resourceId)).digest("base64url");
}

/** Constant-time comparison; false for anything malformed. */
export function verifyResourceQr(qrSecret: string, resourceId: string, sig: string): boolean {
  const expected = Buffer.from(signResourceQr(qrSecret, resourceId));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** What the printed QR encodes: `/checkin?r=<resourceId>&sig=<hmac>` on the PWA (§7). */
export function checkinUrl(publicAppUrl: string, resourceId: string, sig: string): string {
  const url = new URL("/checkin", publicAppUrl);
  url.searchParams.set("r", resourceId);
  url.searchParams.set("sig", sig);
  return url.toString();
}
