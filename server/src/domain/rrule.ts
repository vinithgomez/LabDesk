/**
 * The RFC 5545 recurrence subset LabDesk accepts (CLAUDE.md §4 booking_series):
 * FREQ=WEEKLY;BYDAY=<days>;UNTIL=<date>. Pure: callers supply every instant.
 *
 * Occurrence times are IST wall-clock (the same calendar the same-day rule
 * uses). IST is a fixed UTC+05:30 with no daylight saving, so an occurrence's
 * UTC instant never drifts across the series.
 */
import { istDate, istInstant } from "./booking-rules.js";
import { DomainError } from "./errors.js";

/** Indexed like Date#getUTCDay(): 0 = Sunday. */
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Monday-first, the order a normalized BYDAY lists days in. */
const WEEK_ORDER: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/**
 * UNTIL is inclusive (RFC 5545 §3.3.10). A DATE bounds occurrences by IST
 * calendar date; a UTC DATE-TIME bounds their start instant.
 */
export type Until = { kind: "date"; date: string } | { kind: "instant"; at: Date };

export interface WeeklyRule {
  byDay: readonly Weekday[];
  until: Until;
}

export interface Occurrence {
  startsAt: Date;
  endsAt: Date;
}

const DAY_MS = 86_400_000;
const SUPPORTED = "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231";

const invalid = (message: string): DomainError =>
  new DomainError("INVALID_RRULE", `${message} (supported form: ${SUPPORTED})`);

/** Parses and validates the supported subset; anything else is INVALID_RRULE. */
export function parseWeeklyRule(text: string): WeeklyRule {
  const body = text.trim().toUpperCase().replace(/^RRULE:/, "");
  const parts = new Map<string, string>();
  for (const part of body.split(";")) {
    const match = /^([A-Z]+)=(.+)$/.exec(part);
    if (!match?.[1] || !match[2]) throw invalid(`Malformed RRULE part "${part}"`);
    if (parts.has(match[1])) throw invalid(`RRULE part ${match[1]} appears twice`);
    parts.set(match[1], match[2]);
  }
  for (const key of parts.keys()) {
    if (key !== "FREQ" && key !== "BYDAY" && key !== "UNTIL") throw invalid(`Unsupported RRULE part ${key}`);
  }

  const freq = parts.get("FREQ");
  if (freq !== "WEEKLY") throw invalid(freq ? `Unsupported FREQ=${freq}` : "FREQ is required");

  const byDayText = parts.get("BYDAY");
  if (!byDayText) throw invalid("BYDAY is required");
  const days = new Set<Weekday>();
  for (const day of byDayText.split(",")) {
    const weekday = WEEKDAYS.find((w) => w === day);
    if (!weekday) throw invalid(`Unsupported BYDAY value "${day}"`);
    days.add(weekday);
  }

  const untilText = parts.get("UNTIL");
  if (!untilText) throw invalid("UNTIL is required");
  return { byDay: WEEK_ORDER.filter((d) => days.has(d)), until: parseUntil(untilText) };
}

function parseUntil(text: string): Until {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (date) {
    const iso = `${date[1]}-${date[2]}-${date[3]}`;
    if (!isRealDate(iso)) throw invalid(`UNTIL=${text} is not a valid date`);
    return { kind: "date", date: iso };
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (dateTime) {
    const iso = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}`;
    const at = new Date(`${iso}T${dateTime[4]}:${dateTime[5]}:${dateTime[6]}Z`);
    if (!isRealDate(iso) || Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== iso) {
      throw invalid(`UNTIL=${text} is not a valid UTC date-time`);
    }
    return { kind: "instant", at };
  }
  throw invalid(`UNTIL must be YYYYMMDD or YYYYMMDDTHHMMSSZ, got ${text}`);
}

function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** The canonical text stored for a rule, e.g. FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231. */
export function formatWeeklyRule(rule: WeeklyRule): string {
  const until =
    rule.until.kind === "date"
      ? rule.until.date.replaceAll("-", "")
      : rule.until.at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `FREQ=WEEKLY;BYDAY=${rule.byDay.join(",")};UNTIL=${until}`;
}

/**
 * The rule's occurrences with `after < start` and `end <= through`, in order.
 * `startTime` is IST wall-clock "HH:MM". Iterates IST calendar days, so the
 * cost is bounded by the window, not by UNTIL.
 */
export function occurrencesBetween(
  rule: WeeklyRule,
  startTime: string,
  durationMinutes: number,
  after: Date,
  through: Date,
): Occurrence[] {
  const out: Occurrence[] = [];
  const lastDate = istDate(through);
  for (let day = new Date(`${istDate(after)}T00:00:00Z`); ; day = new Date(day.getTime() + DAY_MS)) {
    const date = day.toISOString().slice(0, 10);
    if (date > lastDate) break;
    const weekday = WEEKDAYS[day.getUTCDay()];
    if (weekday === undefined || !rule.byDay.includes(weekday)) continue;

    const startsAt = istInstant(date, startTime);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    if (!withinUntil(rule.until, date, startsAt)) continue;
    if (startsAt.getTime() > after.getTime() && endsAt.getTime() <= through.getTime()) {
      out.push({ startsAt, endsAt });
    }
  }
  return out;
}

/** The first occurrence starting after `after`, or null if UNTIL has passed. */
export function nextOccurrence(
  rule: WeeklyRule,
  startTime: string,
  durationMinutes: number,
  after: Date,
): Occurrence | null {
  // Every weekday recurs within any 8 consecutive calendar days, so if there
  // is no occurrence in that window, UNTIL has cut the series off.
  const window = occurrencesBetween(rule, startTime, durationMinutes, after, new Date(after.getTime() + 9 * DAY_MS));
  return window[0] ?? null;
}

function withinUntil(until: Until, date: string, startsAt: Date): boolean {
  return until.kind === "date" ? date <= until.date : startsAt.getTime() <= until.at.getTime();
}
