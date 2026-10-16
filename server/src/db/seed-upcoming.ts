/**
 * Upcoming demo data: bookings for the next UPCOMING_DAYS days, one
 * maintenance window and one weekly series, so the calendar, the approvals
 * inbox and the series page look alive whichever day the seed runs.
 *
 * Unlike the history (seed-history.ts), nothing here is inserted directly:
 * every booking, approval, series and maintenance window goes through the
 * app's own services, as an API request would (BookingService.create and
 * transitionBooking, SeriesService.create, MaintenanceService.create), after
 * the same policy checks the routes make. So the slot rules, the exclusion
 * constraint, the horizon and the audit log all apply exactly as in the app.
 *
 * The plan is pure (planUpcoming and friends, unit tested) and deterministic
 * per (resource, IST date): each day draws from its own random stream,
 * "upcoming|<resource>|<date>", separate from the history's streams, so the
 * history, the heatmap and the analytics numbers are untouched, and seeding
 * again on a later day plans the same bookings for the days already planned.
 *
 * Idempotent: bookings carry Idempotency-Keys "seed:upcoming:…" and replay;
 * an approval left half-done is finished; an existing active series of the
 * same shape is extended rather than duplicated; a live maintenance window
 * with the same reason is reused. A slot someone else already holds is
 * skipped (SLOT_CONFLICT), never forced.
 */
import { can } from "../auth/policy.js";
import { horizonEnd, istDate, istInstant } from "../domain/booking-rules.js";
import { DomainError } from "../domain/errors.js";
import type { Actor, Resource } from "../domain/types.js";
import { createUnitOfWork } from "../repositories/index.js";
import { BookingService } from "../services/booking.service.js";
import { MaintenanceService } from "../services/maintenance.service.js";
import { SeriesService } from "../services/series.service.js";
import type { PrismaClient } from "./prisma.js";

/** Days ahead the seed books, starting tomorrow (IST). */
export const UPCOMING_DAYS = 12;
/** Share of the history's booking rate that is already booked ahead. */
const UPCOMING_DENSITY = 0.45;
/** The maintenance window lands on the first business day at least this many days ahead… */
const MAINTENANCE_FROM_DAY = 3;
/** …and no later than this. */
const MAINTENANCE_TO_DAY = 10;
/** The series repeats until about six weeks out. */
const SERIES_WEEKS = 6;

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/** Relative demand by IST hour (a late-morning and a mid-afternoon peak), as in the history. */
const HOUR_WEIGHT: Record<number, number> = {
  8: 0.45, 9: 0.8, 10: 1, 11: 1, 12: 0.55, 13: 0.5, 14: 0.9, 15: 1, 16: 0.8, 17: 0.5, 18: 0.35, 19: 0.25,
  20: 0.2, 21: 0.15,
};

export interface UpcomingResource {
  id: string;
  name: string;
  requiresApproval: boolean;
  capacity: number;
  minSlotMinutes: number;
  maxSlotMinutes: number;
  bookingHorizonDays: number;
  /** IST "HH:MM". */
  businessHoursStart: string;
  businessHoursEnd: string;
  /** 0 = Sunday. */
  businessDays: readonly number[];
  /** Owners and the level each decides at; never booked by themselves when approval is needed. */
  owners: readonly { userId: string; approvalLevel: number }[];
  /** Chance a free half-hour at peak time starts a booking (0: the random fill leaves it alone). */
  intensity: number;
  lengths: readonly number[];
  bookers: readonly { userId: string; weight: number }[];
  purposes: readonly string[];
  attendees: { min: number; max: number };
}

/** A booking that recurs on a weekday, planned before the random fill (a demo persona's own week). */
export interface WeeklyAnchor {
  resourceId: string;
  /** 0 = Sunday. */
  weekday: number;
  start: string;
  minutes: number;
  userId: string;
  purpose: string;
  attendeeCount: number;
  /** For a resource that needs approval: approved by its owners, or left waiting. */
  status: "approved" | "pending";
}

/** A weekly time kept free (a series' slots). */
export interface WeeklySlot {
  resourceId: string;
  weekdays: readonly number[];
  start: string;
  minutes: number;
  /** Whose time it is (a series' booker): they are never booked elsewhere then. */
  userId?: string;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface UpcomingPlanInput {
  now: Date;
  resources: readonly UpcomingResource[];
  anchors: readonly WeeklyAnchor[];
  reservedWeekly: readonly WeeklySlot[];
  /** Times that can't be booked (maintenance windows), by resource id. */
  blocked: ReadonlyMap<string, readonly Interval[]>;
  days?: number;
}

export interface PlannedUpcoming {
  key: string;
  resourceId: string;
  userId: string;
  start: Date;
  end: Date;
  purpose: string;
  attendeeCount: number;
  /** What it should end up as: approved (by its owners, where approval is needed) or pending. */
  status: "approved" | "pending";
}

/** The IST dates from tomorrow to `days` days ahead. */
export function upcomingDates(now: Date, days = UPCOMING_DAYS): string[] {
  const noon = istInstant(istDate(now), "12:00").getTime();
  return Array.from({ length: days }, (_, i) => istDate(new Date(noon + (i + 1) * DAY_MS)));
}

const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMinutes = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;
const at = (date: string, hhmm: string, minutes: number): Interval => {
  const start = istInstant(date, hhmm);
  return { start, end: new Date(start.getTime() + minutes * MIN_MS) };
};

/**
 * The bookings to seed, for `now`. Per resource and day: the weekly anchors
 * first, then a random fill that walks the open hours in half-hour steps
 * around them and around the reserved weekly slots. Then the filters that
 * depend on `now` and on what exists: inside the horizon, and clear of
 * maintenance windows. Every booking is inside business hours and days,
 * within the resource's min and max length and its capacity, no two on one
 * resource overlap, and nobody is booked in two places at once.
 */
export function planUpcoming(input: UpcomingPlanInput): PlannedUpcoming[] {
  const out: PlannedUpcoming[] = [];
  const dates = upcomingDates(input.now, input.days);
  for (const date of dates) {
    // Who is already booked when, that day: their weekly anchors and slots first, then each resource's plan in turn.
    const busy = busyPeople(date, input);
    for (const resource of input.resources) {
      if (!resource.businessDays.includes(weekdayOf(date))) continue;
      const day = planDay(resource, date, input, busy);
      const latestEnd = horizonEnd(resource, input.now).getTime();
      const blocked = input.blocked.get(resource.id) ?? [];
      for (const b of day) {
        if (b.start.getTime() <= input.now.getTime() || b.end.getTime() > latestEnd) continue;
        if (blocked.some((w) => overlaps(w, b))) continue;
        out.push(b);
      }
    }
  }
  return out;
}

/** The anchors' and weekly slots' people on `date`, with their times; anchors for one person never overlap. */
function busyPeople(date: string, input: UpcomingPlanInput): Map<string, Interval[]> {
  const weekday = weekdayOf(date);
  const busy = new Map<string, Interval[]>();
  const add = (userId: string, slot: Interval, what: string) => {
    const times = busy.get(userId) ?? [];
    if (times.some((t) => overlaps(t, slot))) throw new Error(`${what} double-books ${userId} on ${date}`);
    busy.set(userId, [...times, slot]);
  };
  for (const r of input.reservedWeekly) {
    if (r.userId && r.weekdays.includes(weekday)) add(r.userId, at(date, r.start, r.minutes), "A weekly slot");
  }
  for (const a of input.anchors) {
    const resource = input.resources.find((x) => x.id === a.resourceId);
    if (a.weekday === weekday && resource?.businessDays.includes(weekday)) add(a.userId, at(date, a.start, a.minutes), "An anchor");
  }
  return busy;
}

/**
 * One resource's day: depends only on the resource, the date, the weekly
 * anchors and slots, and the resources planned before it that day (through
 * `busy`), never on `now`. Adds its bookers' times to `busy`.
 */
function planDay(
  resource: UpcomingResource,
  date: string,
  input: UpcomingPlanInput,
  busy: Map<string, Interval[]>,
): PlannedUpcoming[] {
  const weekday = weekdayOf(date);
  const open = toMinutes(resource.businessHoursStart);
  const close = toMinutes(resource.businessHoursEnd);
  const planned: PlannedUpcoming[] = [];

  for (const a of input.anchors.filter((x) => x.resourceId === resource.id && x.weekday === weekday)) {
    const slot = at(date, a.start, a.minutes);
    assertAnchorFits(resource, a, open, close);
    if (planned.some((p) => overlaps(p, slot))) throw new Error(`Anchors overlap on ${resource.name} ${date} ${a.start}`);
    planned.push({
      key: keyOf(resource, slot.start),
      resourceId: resource.id,
      userId: a.userId,
      ...slot,
      purpose: a.purpose,
      attendeeCount: a.attendeeCount,
      status: resource.requiresApproval ? a.status : "approved",
    });
  }

  const kept: Interval[] = [
    ...planned,
    ...input.reservedWeekly
      .filter((r) => r.resourceId === resource.id && r.weekdays.includes(weekday))
      .map((r) => at(date, r.start, r.minutes)),
  ];

  const ownerIds = new Set(resource.owners.map((o) => o.userId));
  // Where approval is needed, an owner never books: nobody approves their own booking.
  const bookers = resource.bookers.filter((b) => !resource.requiresApproval || !ownerIds.has(b.userId));
  const lengths = resource.lengths.filter((l) => l >= resource.minSlotMinutes && l <= resource.maxSlotMinutes);
  if (resource.intensity <= 0 || lengths.length === 0 || bookers.length === 0) return planned;

  // Thinner than the history's busiest days: these are bookings made so far, not the whole week's use.
  const intensity = resource.intensity * UPCOMING_DENSITY;
  const rand = rng(`upcoming|${resource.name}|${date}`);
  let cursor = open;
  while (cursor + Math.min(...lengths) <= close) {
    const fitting = lengths.filter((l) => cursor + l <= close && !kept.some((k) => overlaps(k, at(date, fromMinutes(cursor), l))));
    if (fitting.length === 0 || rand() >= intensity * (HOUR_WEIGHT[Math.floor(cursor / 60)] ?? 0.1)) {
      cursor += 30;
      continue;
    }
    const length = pick(rand, fitting);
    const slot = at(date, fromMinutes(cursor), length);
    const userId = weighted(rand, bookers);
    const approved = !resource.requiresApproval || rand() < 0.55;
    if ((busy.get(userId) ?? []).some((t) => overlaps(t, slot))) {
      // They're already somewhere else then: nobody books this slot.
      cursor += 30;
      continue;
    }
    busy.set(userId, [...(busy.get(userId) ?? []), slot]);
    const key = keyOf(resource, slot.start);
    planned.push({ key, resourceId: resource.id, userId, ...slot, ...details(resource, key), status: approved ? "approved" : "pending" });
    kept.push(slot);
    cursor += length + (rand() < 0.5 ? 0 : 30);
  }
  return planned.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function assertAnchorFits(resource: UpcomingResource, a: WeeklyAnchor, open: number, close: number): void {
  const from = toMinutes(a.start);
  const fits =
    from >= open &&
    from + a.minutes <= close &&
    a.minutes >= resource.minSlotMinutes &&
    a.minutes <= resource.maxSlotMinutes &&
    a.attendeeCount >= 1 &&
    (resource.capacity === 0 || a.attendeeCount <= resource.capacity);
  if (!fits) throw new Error(`Anchor ${resource.name} ${a.start} (${a.minutes} min) doesn't fit the resource's rules`);
}

const keyOf = (resource: UpcomingResource, start: Date): string => `seed:upcoming:${resource.id}:${start.toISOString()}`;

/** Purpose and attendee count from their own stream (seeded by the key), so they don't move the schedule. */
function details(resource: UpcomingResource, key: string): { purpose: string; attendeeCount: number } {
  const rand = rng(`${key}|details`);
  const max = resource.capacity > 0 ? Math.min(resource.attendees.max, resource.capacity) : resource.attendees.max;
  const min = Math.min(resource.attendees.min, max);
  return { purpose: pick(rand, resource.purposes), attendeeCount: min + Math.floor(rand() * (max - min + 1)) };
}

/**
 * The maintenance window: `hours` long from `startsAt`, on the first of the
 * resource's business days between MAINTENANCE_FROM_DAY and
 * MAINTENANCE_TO_DAY days ahead, kept inside its business hours.
 */
export function planMaintenance(resource: UpcomingResource, now: Date, startsAt: string, hours: number): Interval {
  const today = istDate(now);
  const open = toMinutes(resource.businessHoursStart);
  const close = toMinutes(resource.businessHoursEnd);
  const from = Math.max(open, Math.min(toMinutes(startsAt), close - hours * 60));
  for (let d = MAINTENANCE_FROM_DAY; d <= MAINTENANCE_TO_DAY; d += 1) {
    const date = istDate(new Date(istInstant(today, "12:00").getTime() + d * DAY_MS));
    if (resource.businessDays.includes(weekdayOf(date))) return at(date, fromMinutes(from), hours * 60);
  }
  throw new Error(`${resource.name} has no business day between ${MAINTENANCE_FROM_DAY} and ${MAINTENANCE_TO_DAY} days ahead`);
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** FREQ=WEEKLY;BYDAY=…;UNTIL=… for `weekdays` (0 = Sunday), until about SERIES_WEEKS weeks from `now`. */
export function seriesRule(weekdays: readonly number[], now: Date): string {
  const until = istDate(new Date(istInstant(istDate(now), "12:00").getTime() + SERIES_WEEKS * 7 * DAY_MS)).replaceAll("-", "");
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => weekdays.includes(d)).map((d) => BYDAY[d]);
  return `FREQ=WEEKLY;BYDAY=${days.join(",")};UNTIL=${until}`;
}

// ---- Writing it, through the app's services ------------------------------------

export interface UpcomingMaintenance {
  resourceId: string;
  startsAt: string;
  hours: number;
  reason: string;
  /** Who schedules it: one of the resource's owners. */
  createdBy: string;
}

export interface UpcomingSeries extends WeeklySlot {
  userId: string;
  purpose: string;
  attendeeCount: number;
}

export interface UpcomingSeed {
  resources: readonly UpcomingResource[];
  anchors: readonly WeeklyAnchor[];
  maintenance: UpcomingMaintenance;
  series: UpcomingSeries;
}

export interface UpcomingResult {
  /** New bookings, and of those how many ended approved or pending. */
  created: number;
  approved: number;
  pending: number;
  /** Planned bookings that already existed (an earlier run). */
  existing: number;
  /** Planned bookings refused by the app's rules (a slot someone else holds, …), by error code. */
  skipped: Record<string, number>;
  maintenance: "created" | "existing";
  series: { state: "created" | "existing"; booked: number; skipped: number };
}

export async function seedUpcoming(prisma: PrismaClient, seed: UpcomingSeed, now: Date): Promise<UpcomingResult> {
  const uow = createUnitOfWork(prisma);
  const clock = () => now;
  const bookings = new BookingService(uow, clock);
  const series = new SeriesService(uow, bookings, clock);
  const maintenance = new MaintenanceService(uow, bookings, clock);
  const result: UpcomingResult = {
    created: 0,
    approved: 0,
    pending: 0,
    existing: 0,
    skipped: {},
    maintenance: "existing",
    series: { state: "existing", booked: 0, skipped: 0 },
  };

  const actors = new Map<string, Actor>();
  const actor = async (userId: string): Promise<Actor> => {
    const known = actors.get(userId);
    if (known) return known;
    const user = await uow.read.users.findById(userId);
    if (!user) throw new Error(`Seed user ${userId} not found`);
    const a: Actor = { id: user.id, role: user.role, departmentId: user.departmentId, isActive: user.isActive };
    actors.set(userId, a);
    return a;
  };
  const resourceOf = async (id: string): Promise<Resource> => {
    const r = await uow.read.resources.findById(id);
    if (!r) throw new Error(`Seed resource ${id} not found`);
    return r;
  };

  // 1. The maintenance window, first, so no booking is planned over it.
  const m = seed.maintenance;
  const mResource = await resourceOf(m.resourceId);
  const live = await maintenance.listUpcoming(m.resourceId);
  if (!live.some((w) => w.reason === m.reason)) {
    const scheduler = await actor(m.createdBy);
    if (!can(scheduler, "maintenance:create", { id: mResource.id, departmentId: mResource.departmentId, ownerIds: mResource.ownerIds })) {
      throw new Error(`${m.createdBy} may not schedule maintenance on ${mResource.name}`);
    }
    const planned = planMaintenance(resourceById(seed, m.resourceId), now, m.startsAt, m.hours);
    await maintenance.create(scheduler, { resourceId: m.resourceId, startsAt: planned.start, endsAt: planned.end, reason: m.reason });
    result.maintenance = "created";
  }

  // 2. The weekly series, through the series code path (create, or extend an existing one).
  const s = seed.series;
  const booker = await actor(s.userId);
  const sResource = await resourceOf(s.resourceId);
  const existing = await prisma.bookingSeries.findFirst({
    where: { userId: s.userId, resourceId: s.resourceId, status: "active", purpose: s.purpose },
    select: { id: true },
  });
  if (existing) {
    const extended = await series.materialize(existing.id, booker.id);
    result.series = { state: "existing", booked: extended.created, skipped: extended.skipped };
  } else {
    if (!can(booker, "series:create", sResource)) throw new Error(`${s.userId} may not book ${sResource.name}`);
    const created = await series.create(booker, {
      resourceId: s.resourceId,
      rrule: seriesRule(s.weekdays, now),
      startTime: s.start,
      durationMinutes: s.minutes,
      purpose: s.purpose,
      attendeeCount: s.attendeeCount,
    });
    result.series = { state: "created", booked: created.occurrences.length, skipped: created.skipped.length };
  }

  // 3. The bookings, around every live maintenance window.
  const blocked = new Map<string, Interval[]>();
  for (const r of seed.resources) {
    blocked.set(
      r.id,
      (await maintenance.listUpcoming(r.id)).map((w) => ({ start: w.startsAt, end: w.endsAt })),
    );
  }
  const plan = planUpcoming({ now, resources: seed.resources, anchors: seed.anchors, reservedWeekly: [s], blocked });

  for (const p of plan) {
    const who = await actor(p.userId);
    const resource = await resourceOf(p.resourceId);
    if (!can(who, "booking:create", resource)) {
      result.skipped.FORBIDDEN = (result.skipped.FORBIDDEN ?? 0) + 1;
      continue;
    }
    try {
      const { booking, replayed } = await bookings.create(who, {
        resourceId: p.resourceId,
        startsAt: p.start,
        endsAt: p.end,
        purpose: p.purpose,
        attendeeCount: p.attendeeCount,
        idempotencyKey: p.key,
      });
      if (replayed) result.existing += 1;
      else result.created += 1;
      const status =
        p.status === "approved" && booking.status === "pending" ? await approveAllLevels(bookings, booking.id, actor) : booking.status;
      if (!replayed && status === "approved") result.approved += 1;
      if (!replayed && status === "pending") result.pending += 1;
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      result.skipped[err.code] = (result.skipped[err.code] ?? 0) + 1;
    }
  }
  return result;
}

/** Approves a pending booking at each level in turn, as its owners would in the inbox. Returns its final status. */
async function approveAllLevels(
  bookings: BookingService,
  bookingId: string,
  actor: (userId: string) => Promise<Actor>,
): Promise<string> {
  for (;;) {
    const state = await bookings.getApprovalState(bookingId);
    const level = state.progress.nextLevel;
    if (state.booking.status !== "pending" || level === null) return state.booking.status;
    const subject = {
      id: state.booking.id,
      userId: state.booking.userId,
      status: state.booking.status,
      resource: {
        id: state.resource.id,
        departmentId: state.resource.departmentId,
        ownerIds: state.resource.ownerIds,
        owners: state.resource.owners,
      },
      nextLevel: level,
      deciderIds: state.progress.deciderIds,
    };
    let approver: Actor | null = null;
    for (const owner of state.resource.owners.filter((o) => o.approvalLevel === level)) {
      const candidate = await actor(owner.userId);
      if (can(candidate, "booking:approve", subject)) {
        approver = candidate;
        break;
      }
    }
    if (!approver) return state.booking.status; // nobody may decide this level: leave it pending
    await bookings.transitionBooking(bookingId, "approve", approver, { level, comment: "" });
  }
}

function resourceById(seed: UpcomingSeed, id: string): UpcomingResource {
  const r = seed.resources.find((x) => x.id === id);
  if (!r) throw new Error(`Resource ${id} is not in the upcoming plan`);
  return r;
}

// ---- small deterministic helpers (as in seed-history.ts) -------------------------

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
