import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Calendar-feed tokens (CLAUDE.md §9 GET /api/calendar/:icsToken.ics).
 *
 * token = base64url( userId (16 bytes) || feedVersion (uint32 BE) || HMAC )
 * where HMAC = HMAC-SHA256(secret, "labdesk:ics:v1:<userId>:<feedVersion>").
 *
 * - Unguessable: forging one needs the server secret, so knowing a user's id
 *   is no help; it is not the session token and grants nothing but the feed.
 * - Never stored: the database holds only the version number, so a leaked
 *   database yields no feed URLs.
 * - Stable: recomputed on demand, so the URL can be shown again any time.
 * - Revocable: regenerating bumps the version, and every older token stops
 *   verifying at once.
 */
const PAYLOAD_BYTES = 16 + 4;
const MAC_BYTES = 32;

function mac(secret: string, userId: string, version: number): Buffer {
  return createHmac("sha256", secret).update(`labdesk:ics:v1:${userId}:${version}`).digest();
}

function uuidToBytes(id: string): Buffer {
  const hex = id.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("not a uuid");
  return Buffer.from(hex, "hex");
}

function bytesToUuid(b: Buffer): string {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function signIcsToken(secret: string, userId: string, version: number): string {
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  uuidToBytes(userId).copy(payload, 0);
  payload.writeUInt32BE(version, 16);
  return Buffer.concat([payload, mac(secret, userId, version)]).toString("base64url");
}

/**
 * The user and version a token claims, if its MAC is genuine. The caller
 * must still check the version is the user's current one.
 */
export function readIcsToken(secret: string, token: string): { userId: string; version: number } | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  // Exactly one spelling per token: a string that decodes to the same bytes
  // (e.g. different unused trailing bits) is not accepted as an alias.
  if (raw.length !== PAYLOAD_BYTES + MAC_BYTES || raw.toString("base64url") !== token) return null;
  const userId = bytesToUuid(raw.subarray(0, 16));
  const version = raw.readUInt32BE(16);
  const expected = mac(secret, userId, version);
  return timingSafeEqual(expected, raw.subarray(PAYLOAD_BYTES)) ? { userId, version } : null;
}
