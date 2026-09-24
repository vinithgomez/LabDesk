/**
 * Audit entries and snapshot redaction (CLAUDE.md §2c, §4 audit_log).
 * Pure: no database access. The write itself is `tx.writeAudit()`, which is
 * only available inside a unit-of-work transaction.
 */

export type AuditEntityType = "user" | "resource" | "booking" | "waitlist_entry" | "booking_series";

export type AuditAction =
  | "user.role_changed"
  | "resource.created"
  | "resource.updated"
  | "resource.deactivated"
  | "resource.owners_changed"
  | "booking.created"
  | "booking.cancelled"
  | "booking.level_approved"
  | "booking.approved"
  | "booking.rejected"
  | "booking.checked_in"
  | "booking.checked_out"
  | "booking.checkin_overridden"
  | "booking.checkout_overridden"
  | "booking.no_show"
  | "booking.auto_completed"
  | "booking.expired"
  | "waitlist.joined"
  | "waitlist.promoted"
  | "waitlist.expired"
  | "waitlist.cancelled"
  | "series.created"
  | "series.cancelled"
  | "series.occurrence_skipped";

export interface AuditEntry {
  /** null is reserved for system actors (scheduled jobs in later phases). */
  actorId: string | null;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  /** Entity state before the mutation; null for creations. */
  before: object | null;
  /** Entity state after the mutation. */
  after: object | null;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/**
 * Keys that must never reach an audit row, at any depth. Deliberately broad:
 * anything named like a password, secret or token is dropped, which covers
 * password_hash / passwordHash, qr_secret / qrSecret and future ICS tokens.
 */
const SENSITIVE_KEY = /(password|secret|token)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function toJson(value: unknown): JsonValue | undefined {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    case "object": {
      if (Array.isArray(value)) return value.map((v) => toJson(v) ?? null);
      const out: JsonObject = {};
      for (const [key, v] of Object.entries(value)) {
        if (isSensitiveKey(key)) continue;
        const json = toJson(v);
        if (json !== undefined) out[key] = json;
      }
      return out;
    }
    default:
      // undefined, functions, symbols: omitted, as JSON.stringify would.
      return undefined;
  }
}

/** Converts an entity into a redacted, JSON-safe snapshot for storage. */
export function toAuditSnapshot(entity: object | null): JsonObject | null {
  if (entity === null) return null;
  const json = toJson(entity);
  if (json === null || json === undefined || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("Audit snapshots must be plain objects");
  }
  return json;
}
