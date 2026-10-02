import { formatInTimeZone } from "date-fns-tz";
import { IST, istDayStart, type DayKey } from "./grid";

/** Display formats. Always IST, never the browser's zone and never UTC. */

export const formatTime = (instant: Date) => formatInTimeZone(instant, IST, "HH:mm");

/** "Mon 28" for a column header. */
export const formatDayShort = (day: DayKey) => formatInTimeZone(istDayStart(day), IST, "EEE d");

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

/** "Fri 2 Oct, 10:15" */
export const formatDateTime = (instant: Date) => formatInTimeZone(instant, IST, "EEE d MMM, HH:mm");
