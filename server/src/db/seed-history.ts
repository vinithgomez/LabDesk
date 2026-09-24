/**
 * Demo history for the analytics dashboard (Phase 6): several weeks of past
 * bookings and check-ins with realistic variation — busy and idle resources,
 * a daily rhythm, no-shows (a couple of habitual ones), cancellations,
 * rejections and expiries, early leavers and auto-completed sessions.
 *
 * Demo data only. Rows are inserted directly (the API refuses past starts)
 * and carry idempotency keys "seed:history:...", so they're recognisable.
 *
 * Deterministic per (resource, day): the random stream is seeded from the
 * resource name and the date, so re-running the seed — even on a later day —
 * regenerates identical rows for days already filled, and ON CONFLICT DO
 * NOTHING skips them. (Finished bookings don't hold slots, so the overlap
 * constraint alone wouldn't stop duplicates; the idempotency key does.)
 */
import { istDate, istInstant } from "../domain/booking-rules.js";
import type { PrismaClient } from "./prisma.js";

export interface HistoryResource {
  id: string;
  name: string;
  requiresApproval: boolean;
  minSlotMinutes: number;
  maxSlotMinutes: number;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: number[];
  /** No history before this instant (the resource didn't exist yet). */
  since: Date;
  /** First owner: records manual overrides. */
  ownerId: string | null;
  profile: UsageProfile;
  /** Who books it, with relative weights. */
  bookers: { userId: string; weight: number }[];
}

export interface UsageProfile {
  /** Chance a free half-hour at peak time starts a booking (0 = never used). */
  intensity: number;
  /** Booking lengths to choose from, minutes. */
  lengths: number[];
}

/** Per-user no-show propensity; everyone else uses DEFAULT_NO_SHOW. */
export type NoShowHabits = ReadonlyMap<string, number>;

const DEFAULT_NO_SHOW = 0.07;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/** Relative demand by IST hour: a late-morning and a mid-afternoon peak. */
const HOUR_WEIGHT: Record<number, number> = {
  7: 0.15, 8: 0.45, 9: 0.8, 10: 1, 11: 1, 12: 0.55, 13: 0.5, 14: 0.9, 15: 1, 16: 0.8, 17: 0.5,
  18: 0.35, 19: 0.25, 20: 0.2, 21: 0.15,
};

export interface HistoryResult {
  bookings: number;
  checkins: number;
}

export async function seedHistory(
  prisma: PrismaClient,
  resources: readonly HistoryResource[],
  habits: NoShowHabits,
  opts: { now: Date; weeks: number },
): Promise<HistoryResult> {
  const result: HistoryResult = { bookings: 0, checkins: 0 };
  const today = istDate(opts.now);
  for (const resource of resources) {
    for (let d = opts.weeks * 7; d >= 1; d -= 1) {
      const date = istDate(new Date(istInstant(today, "12:00").getTime() - d * DAY_MS));
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (!resource.businessDays.includes(dow)) continue;
      const day = planDay(resource, date, habits);
      for (const b of day) {
        if (b.start.getTime() < resource.since.getTime()) continue;
        const inserted = await insertHistoricBooking(prisma, resource, b);
        if (inserted) {
          result.bookings += 1;
          if (b.checkin) result.checkins += 1;
        }
      }
    }
  }
  return result;
}

interface PlannedBooking {
  key: string;
  userId: string;
  start: Date;
  end: Date;
  status: "completed" | "no_show" | "cancelled" | "rejected";
  /** A rejected booking that nobody decided in time (audited as booking.expired). */
  expired: boolean;
  checkin: {
    in: Date;
    out: Date;
    checkinMethod: "qr" | "manual_override";
    checkoutMethod: "qr" | "manual_override" | "auto";
  } | null;
}

/** One day's bookings for a resource: walk the open hours in half-hour steps. */
function planDay(resource: HistoryResource, date: string, habits: NoShowHabits): PlannedBooking[] {
  const rand = rng(`${resource.name}|${date}`);
  const open = toMinutes(resource.businessHoursStart);
  const close = toMinutes(resource.businessHoursEnd);
  const lengths = resource.profile.lengths.filter((l) => l >= resource.minSlotMinutes && l <= resource.maxSlotMinutes);
  const out: PlannedBooking[] = [];
  if (resource.profile.intensity <= 0 || lengths.length === 0) return out;

  let cursor = open;
  while (cursor + Math.min(...lengths) <= close) {
    const hour = Math.floor(cursor / 60);
    if (rand() >= resource.profile.intensity * (HOUR_WEIGHT[hour] ?? 0.1)) {
      cursor += 30;
      continue;
    }
    const fitting = lengths.filter((l) => cursor + l <= close);
    const length = pick(rand, fitting);
    const start = istInstant(date, fromMinutes(cursor));
    const end = new Date(start.getTime() + length * MIN_MS);
    const userId = weighted(rand, resource.bookers);
    out.push(outcome(rand, resource, { userId, start, end }, habits.get(userId) ?? DEFAULT_NO_SHOW));
    // Some slack between bookings.
    cursor += length + (rand() < 0.5 ? 0 : 30);
  }
  return out;
}

function outcome(
  rand: () => number,
  resource: HistoryResource,
  b: { userId: string; start: Date; end: Date },
  noShowRate: number,
): PlannedBooking {
  const base = { ...b, key: `seed:history:${resource.id}:${b.start.toISOString()}`, expired: false, checkin: null };
  const roll = rand();
  if (resource.requiresApproval && roll < 0.05) return { ...base, status: "rejected" };
  if (resource.requiresApproval && roll < 0.08) return { ...base, status: "rejected", expired: true };
  if (roll < 0.15) return { ...base, status: "cancelled" };
  if (rand() < noShowRate) return { ...base, status: "no_show" };

  const lengthMs = b.end.getTime() - b.start.getTime();
  // Arrive between 10 minutes early and 12 minutes late.
  const checkedIn = new Date(b.start.getTime() + Math.round((rand() * 22 - 10)) * MIN_MS);
  const checkinMethod = resource.ownerId && rand() < 0.04 ? "manual_override" : "qr";
  const leave = rand();
  let out: Date;
  let checkoutMethod: "qr" | "manual_override" | "auto";
  if (leave < 0.15) {
    // Forgot to check out: auto-completed at the booked end.
    out = b.end;
    checkoutMethod = "auto";
  } else {
    // Leave up to a third of the slot early (or a few minutes late).
    const early = Math.round(rand() * (lengthMs / MIN_MS / 3)) - (rand() < 0.2 ? 5 : 0);
    out = new Date(Math.max(b.end.getTime() - early * MIN_MS, checkedIn.getTime() + 10 * MIN_MS));
    checkoutMethod = resource.ownerId && rand() < 0.03 ? "manual_override" : "qr";
  }
  return { ...base, status: "completed", checkin: { in: checkedIn, out, checkinMethod, checkoutMethod } };
}

/** Inserts one booking (and its check-in); false when it already exists. */
async function insertHistoricBooking(prisma: PrismaClient, r: HistoryResource, b: PlannedBooking): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO bookings (resource_id, user_id, period, status, purpose, attendee_count, idempotency_key, created_at, updated_at)
      VALUES (
        ${r.id}::uuid, ${b.userId}::uuid,
        tstzrange(${b.start.toISOString()}::timestamptz, ${b.end.toISOString()}::timestamptz, '[)'),
        ${b.status}::booking_status, 'Demo history', 1, ${b.key},
        ${new Date(b.start.getTime() - 2 * DAY_MS).toISOString()}::timestamptz, ${b.end.toISOString()}::timestamptz
      )
      ON CONFLICT DO NOTHING
      RETURNING id::text AS id`;
    const bookingId = rows[0]?.id;
    if (!bookingId) return false;

    if (b.expired) {
      await tx.$executeRaw`
        INSERT INTO audit_log (actor_id, entity_type, entity_id, action, before, after, created_at)
        VALUES (NULL, 'booking', ${bookingId}::uuid, 'booking.expired',
                ${JSON.stringify({ status: "pending" })}::jsonb, ${JSON.stringify({ status: "rejected" })}::jsonb,
                ${b.start.toISOString()}::timestamptz)`;
    }
    if (b.checkin) {
      const c = b.checkin;
      const overrider = r.ownerId;
      await tx.$executeRaw`
        INSERT INTO checkins (booking_id, checked_in_at, checked_out_at, checkin_method, overridden_by, checkout_method, checkout_overridden_by)
        VALUES (
          ${bookingId}::uuid, ${c.in.toISOString()}::timestamptz, ${c.out.toISOString()}::timestamptz,
          ${c.checkinMethod}::checkin_method, ${c.checkinMethod === "manual_override" ? overrider : null}::uuid,
          ${c.checkoutMethod}::checkout_method, ${c.checkoutMethod === "manual_override" ? overrider : null}::uuid
        )
        ON CONFLICT DO NOTHING`;
    }
    return true;
  });
}

// ---- small deterministic helpers ------------------------------------------

/** mulberry32, seeded from an FNV-1a hash of `seed`. */
function rng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
}

function weighted(rand: () => number, items: readonly { userId: string; weight: number }[]): string {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let roll = rand() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item.userId;
  }
  const last = items.at(-1);
  if (!last) throw new Error("no bookers");
  return last.userId;
}

const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMinutes = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
