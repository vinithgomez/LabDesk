import { formatInTimeZone } from "date-fns-tz";
import { IST, istDayStart, type DayKey } from "./grid";

/** Display formats. Always IST, never the browser's zone and never UTC. */

export const formatTime = (instant: Date) => formatInTimeZone(instant, IST, "HH:mm");

/** "Mon 28" for a column header. */
export const formatDayShort = (day: DayKey) => formatInTimeZone(istDayStart(day), IST, "EEE d");

/** "Mon" and "28": a column header, on two lines. */
export const formatWeekday = (day: DayKey) => formatInTimeZone(istDayStart(day), IST, "EEE");
export const formatDayOfMonth = (day: DayKey) => formatInTimeZone(istDayStart(day), IST, "d");

/** "Monday 28 September" for screen readers. */
export const formatDayLong = (day: DayKey) => formatInTimeZone(istDayStart(day), IST, "EEEE d MMMM");

/** "Mon 28 Sep" */
export const formatDate = (instant: Date) => formatInTimeZone(instant, IST, "EEE d MMM");

/** "Mon 28 Sep, 10:00–11:30" */
export const formatPeriod = (start: Date, end: Date) => `${formatDate(start)}, ${formatTime(start)}–${formatTime(end)}`;

/** "28 Sep – 4 Oct 2026" */
export function formatWeek(first: DayKey, last: DayKey): string {
  return `${formatInTimeZone(istDayStart(first), IST, "d MMM")} – ${formatInTimeZone(istDayStart(last), IST, "d MMM yyyy")}`;
}

/** "10:00" for a minute of the day; 1440 is shown as "24:00". */
export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A short length for labels on the grid: "30 min", "1 h", "1 h 30 min". */
export function formatLength(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "10:00 to 11:30, 1 h 30 min": a chosen or dragged time, as the grid labels it. */
export function formatSpan(start: Date, end: Date): string {
  return `${formatTime(start)} to ${formatTime(end)}, ${formatLength(Math.round((end.getTime() - start.getTime()) / 60_000))}`;
}

/** "Fri 2 Oct, 10:15" */
export const formatDateTime = (instant: Date) => formatInTimeZone(instant, IST, "EEE d MMM, HH:mm");

/** Monday-first weekdays; value as in Date#getUTCDay (0 = Sunday). */
export const WEEKDAYS: { value: number; short: string; long: string }[] = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
];
