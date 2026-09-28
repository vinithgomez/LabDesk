/**
 * Week-calendar geometry, kept free of React so it can be unit tested.
 *
 * Every calendar date here is an IST date key ("yyyy-MM-dd") and every
 * minute-of-day is IST wall-clock time, whatever zone the browser is in
 * (CLAUDE.md §2: render in local time — for LabDesk that is always IST).
 * Instants are plain `Date`s (UTC underneath). Intervals are half-open
 * [start, end), matching the server's tstzrange periods.
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const IST = "Asia/Kolkata";
/** One grid row. */
export const SLOT_MINUTES = 30;
/** Height of one row, in pixels. Dense: this is a tool used all day. */
export const SLOT_PX = 24;

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/** An IST calendar date, "yyyy-MM-dd". */
export type DayKey = string;

export interface Interval {
  start: Date;
  end: Date;
}

/** Visible minutes of the day, [startMinute, endMinute), both multiples of SLOT_MINUTES. */
export interface GridRange {
  startMinute: number;
  endMinute: number;
}

/** A run of rows within one day column, inclusive at both ends. */
export interface SlotSpan {
  first: number;
  last: number;
}

// ---------------------------------------------------------------------------
// IST days

/** The IST date an instant falls on. */
export function istDayKey(instant: Date): DayKey {
  return formatInTimeZone(instant, IST, "yyyy-MM-dd");
}

/** IST midnight at the start of `day`. */
export function istDayStart(day: DayKey): Date {
  return fromZonedTime(`${day}T00:00:00`, IST);
}

/** IST midnight at the end of `day` (exclusive). */
export function istDayEnd(day: DayKey): Date {
  return istDayStart(addDays(day, 1));
}

/** Calendar arithmetic on date keys (no time zone involved). */
export function addDays(day: DayKey, days: number): DayKey {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, as in a resource's businessDays. */
export function weekday(day: DayKey): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The Monday (IST) of the week containing `instant`. */
export function istWeekStart(instant: Date): DayKey {
  const day = istDayKey(instant);
  return addDays(day, -((weekday(day) + 6) % 7));
}

/** Monday to Sunday. */
export function weekDays(weekStart: DayKey): DayKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Minutes since IST midnight on the instant's own IST day. */
export function istMinuteOfDay(instant: Date): number {
  return (instant.getTime() - istDayStart(istDayKey(instant)).getTime()) / MINUTE_MS;
}

/** The instant `minute` minutes after IST midnight on `day`. */
export function atMinute(day: DayKey, minute: number): Date {
  return new Date(istDayStart(day).getTime() + minute * MINUTE_MS);
}

/**
 * True when [start, end) spans more than one IST date — the server's
 * MULTI_DAY_NOT_SUPPORTED rule. Ending exactly at midnight is still same-day.
 */
export function crossesIstMidnight(start: Date, end: Date): boolean {
  return istDayKey(start) !== istDayKey(new Date(end.getTime() - 1));
}

// ---------------------------------------------------------------------------
// Visible range

/** "HH:MM" → minutes since midnight. */
export function parseHhmm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const floorToSlot = (minute: number) => Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES;
const ceilToSlot = (minute: number) => Math.ceil(minute / SLOT_MINUTES) * SLOT_MINUTES;

/** The part of `interval` on IST date `day`, or null if they don't meet. */
export function clipToDay(interval: Interval, day: DayKey): Interval | null {
  const dayStart = istDayStart(day);
  const dayEnd = istDayEnd(day);
  const start = interval.start > dayStart ? interval.start : dayStart;
  const end = interval.end < dayEnd ? interval.end : dayEnd;
  return start < end ? { start, end } : null;
}

/**
 * Rows to draw: the resource's business hours rounded out to whole rows,
 * widened so any event in the shown days stays visible.
 */
export function gridRange(
  hours: { start: string; end: string },
  events: readonly Interval[],
  days: readonly DayKey[],
): GridRange {
  let startMinute = floorToSlot(parseHhmm(hours.start));
  let endMinute = Math.min(DAY_MINUTES, ceilToSlot(parseHhmm(hours.end)));
  for (const event of events) {
    for (const day of days) {
      const part = clipToDay(event, day);
      if (!part) continue;
      const dayStart = istDayStart(day).getTime();
      startMinute = Math.min(startMinute, floorToSlot((part.start.getTime() - dayStart) / MINUTE_MS));
      endMinute = Math.max(endMinute, ceilToSlot((part.end.getTime() - dayStart) / MINUTE_MS));
    }
  }
  if (startMinute >= endMinute) return { startMinute: 0, endMinute: DAY_MINUTES };
  return { startMinute, endMinute };
}

export function slotCount(range: GridRange): number {
  return (range.endMinute - range.startMinute) / SLOT_MINUTES;
}

// ---------------------------------------------------------------------------
// Pixels

export function minutesToPx(minutes: number): number {
  return (minutes / SLOT_MINUTES) * SLOT_PX;
}

/** Height of a block lasting `minutes`. */
export function durationToHeight(minutes: number): number {
  return minutesToPx(minutes);
}

/** Top edge of row `slot`. */
export function slotToPx(slot: number): number {
  return slot * SLOT_PX;
}

/** The row under a y offset within the column, clamped to the grid. */
export function pxToSlot(y: number, range: GridRange): number {
  return Math.min(slotCount(range) - 1, Math.max(0, Math.floor(y / SLOT_PX)));
}

/** Position of an interval in `day`'s column, clipped to the visible range; null if not visible. */
export function eventBox(interval: Interval, day: DayKey, range: GridRange): { top: number; height: number } | null {
  const visible = clipToDay(interval, day);
  if (!visible) return null;
  const from = Math.max(range.startMinute, minuteIn(day, visible.start));
  const to = Math.min(range.endMinute, minuteIn(day, visible.end));
  if (from >= to) return null;
  return { top: minutesToPx(from - range.startMinute), height: durationToHeight(to - from) };
}

/** Minutes from `day`'s IST midnight to `instant` (may be 1440 for the next midnight). */
function minuteIn(day: DayKey, instant: Date): number {
  return (instant.getTime() - istDayStart(day).getTime()) / MINUTE_MS;
}

// ---------------------------------------------------------------------------
// Slots and selection

export function slotStart(day: DayKey, range: GridRange, slot: number): Date {
  return atMinute(day, range.startMinute + slot * SLOT_MINUTES);
}

export function slotEnd(day: DayKey, range: GridRange, slot: number): Date {
  return slotStart(day, range, slot + 1);
}

/** The first whole minute strictly after `now` — the earliest start the server will still accept. */
export function nextWholeMinute(now: Date): Date {
  return new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Rows that can't be selected: already over (ending at or before the next
 * whole minute), or overlapping something busy. The row containing now
 * stays selectable; its booking starts at the next whole minute.
 */
export function blockedSlots(day: DayKey, range: GridRange, busy: readonly Interval[], now: Date): boolean[] {
  const earliest = nextWholeMinute(now);
  return Array.from({ length: slotCount(range) }, (_, slot) => {
    const cell = { start: slotStart(day, range, slot), end: slotEnd(day, range, slot) };
    return cell.end <= earliest || busy.some((b) => overlaps(b, cell));
  });
}

/** A drag from `anchor` to `current` in either direction, as first..last. */
export function normalizeDrag(anchor: number, current: number): SlotSpan {
  return { first: Math.min(anchor, current), last: Math.max(anchor, current) };
}

/**
 * A drag that stops short of the first blocked row between the anchor and
 * the pointer, so a selection never covers something busy. Null when the
 * anchor itself is blocked.
 */
export function clampDrag(anchor: number, current: number, blocked: readonly boolean[]): SlotSpan | null {
  if (blocked[anchor] !== false) return null;
  const step = current >= anchor ? 1 : -1;
  let reach = anchor;
  while (reach !== current && blocked[reach + step] === false) reach += step;
  return normalizeDrag(anchor, reach);
}

/**
 * The instants a span of rows stands for. The start moves up to the next
 * whole minute when the first row is already under way; null if nothing
 * of the span is left.
 */
export function selectionFromSpan(day: DayKey, range: GridRange, span: SlotSpan, now: Date): Interval | null {
  const earliest = nextWholeMinute(now);
  const first = slotStart(day, range, span.first);
  const start = first > earliest ? first : earliest;
  const end = slotEnd(day, range, span.last);
  return start < end ? { start, end } : null;
}

export interface EndRules {
  minSlotMinutes: number;
  maxSlotMinutes: number;
  /** Latest allowed end (now + booking horizon). */
  latestEnd: Date;
}

/**
 * Row boundaries a booking starting at `start` may end on: the length is
 * within the resource's min and max, the end is within the horizon, the
 * booking stays on one IST day, and no blocked row is crossed.
 */
export function endOptions(
  day: DayKey,
  range: GridRange,
  start: Date,
  blocked: readonly boolean[],
  rules: EndRules,
): Date[] {
  const options: Date[] = [];
  const firstSlot = Math.floor((minuteIn(day, start) - range.startMinute) / SLOT_MINUTES);
  for (let slot = firstSlot; slot < slotCount(range); slot++) {
    if (blocked[slot] !== false) break;
    const end = slotEnd(day, range, slot);
    if (end > rules.latestEnd || crossesIstMidnight(start, end)) break;
    const minutes = (end.getTime() - start.getTime()) / MINUTE_MS;
    if (minutes > rules.maxSlotMinutes) break;
    if (minutes >= rules.minSlotMinutes) options.push(end);
  }
  return options;
}

/** The option matching `wanted`, else the nearest shorter one, else the shortest. */
export function defaultEnd(options: readonly Date[], wanted: Date): Date | null {
  let pick: Date | null = null;
  for (const option of options) if (option <= wanted) pick = option;
  return pick ?? options[0] ?? null;
}

// ---------------------------------------------------------------------------
// Keyboard

export interface Cell {
  day: number;
  slot: number;
}

/** Arrow keys move one row or one day; Home/End jump to the first/last row. Null for other keys. */
export function moveCell(cell: Cell, key: string, slots: number): Cell | null {
  const clampSlot = (s: number) => Math.min(slots - 1, Math.max(0, s));
  const clampDay = (d: number) => Math.min(6, Math.max(0, d));
  switch (key) {
    case "ArrowUp":
      return { ...cell, slot: clampSlot(cell.slot - 1) };
    case "ArrowDown":
      return { ...cell, slot: clampSlot(cell.slot + 1) };
    case "ArrowLeft":
      return { ...cell, day: clampDay(cell.day - 1) };
    case "ArrowRight":
      return { ...cell, day: clampDay(cell.day + 1) };
    case "Home":
      return { ...cell, slot: 0 };
    case "End":
      return { ...cell, slot: slots - 1 };
    default:
      return null;
  }
}
