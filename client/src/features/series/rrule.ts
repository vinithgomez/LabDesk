/**
 * Weekly repeats, as the server accepts them: exactly
 * FREQ=WEEKLY;BYDAY=<days>;UNTIL=<YYYYMMDD>, days Monday-first (the server's
 * canonical order). UNTIL is an IST calendar date and inclusive.
 */
import { formatInTimeZone } from "date-fns-tz";
import { IST, istDayKey, istDayStart, weekday, type DayKey } from "../calendar/grid";

/** Indexed like Date#getUTCDay(): 0 = Sunday. */
const CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
/** Monday-first, the order BYDAY lists days in. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface Repeat {
  /** 0 = Sunday … 6 = Saturday. */
  days: readonly number[];
  /** Last date (inclusive), "yyyy-MM-dd" in IST. */
  until: DayKey;
}

/** A real calendar date in yyyy-MM-dd form. */
export function isDayKey(text: string): boolean {
  if (!DAY_KEY.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231. Throws on input validateRepeat would refuse. */
export function buildWeeklyRrule(repeat: Repeat): string {
  const days = WEEK_ORDER.filter((d) => repeat.days.includes(d));
  if (days.length === 0) throw new Error("buildWeeklyRrule: no days");
  if (repeat.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("buildWeeklyRrule: day out of range");
  if (!isDayKey(repeat.until)) throw new Error(`buildWeeklyRrule: bad UNTIL ${repeat.until}`);
  return `FREQ=WEEKLY;BYDAY=${days.map((d) => CODES[d]).join(",")};UNTIL=${repeat.until.replaceAll("-", "")}`;
}

/**
 * Why a repeat can't be sent, or null. `first` is the chosen slot's start:
 * the repeat must include its weekday's following weeks, so UNTIL can't be
 * before that date.
 */
export function validateRepeat(repeat: Repeat, first: Date): string | null {
  if (repeat.days.length === 0) return "Choose at least one day of the week.";
  if (!isDayKey(repeat.until)) return "Choose the last date it repeats until.";
  if (repeat.until < istDayKey(first)) return "The end date can't be before the first booking.";
  return null;
}

/** The repeat a slot starts with: its own weekday, for four more weeks. */
export function defaultRepeat(first: Date): Repeat {
  const day = istDayKey(first);
  const until = new Date(`${day}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 28);
  return { days: [weekday(day)], until: until.toISOString().slice(0, 10) };
}

/** IST "HH:MM" of a slot, the series' start time. */
export const seriesStartTime = (start: Date): string => formatInTimeZone(start, IST, "HH:mm");

const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Every Mon and Wed until Thu 31 Dec 2026", from the server's canonical rule. Null if it isn't one. */
export function describeRrule(rrule: string): string | null {
  const m = /^FREQ=WEEKLY;BYDAY=([A-Z,]+);UNTIL=(\d{4})(\d{2})(\d{2})(T\d{6}Z)?$/.exec(rrule.trim().toUpperCase());
  if (!m?.[1]) return null;
  const days = m[1].split(",").map((c) => CODES.indexOf(c as (typeof CODES)[number]));
  if (days.some((d) => d < 0)) return null;
  const names = days.map((d) => DAY_NAME[d] ?? "?");
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const until = `${m[2]}-${m[3]}-${m[4]}`;
  if (!isDayKey(until)) return null;
  return `Every ${list} until ${formatInTimeZone(istDayStart(until), IST, "EEE d MMM yyyy")}`;
}
