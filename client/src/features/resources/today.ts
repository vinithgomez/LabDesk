/**
 * Today's availability at a glance, for the resource list (DESIGN.md §6):
 * pure, from the availability endpoint's busy intervals for today (IST).
 */
import type { BusyInterval } from "../bookings/types";
import { formatTime } from "../calendar/format";
import { atMinute, istDayKey, parseHhmm, weekday } from "../calendar/grid";

export type TodayState = "free" | "in-use" | "maintenance" | "opens-later" | "closed";

export interface TodaySummary {
  state: TodayState;
  /** A short sentence fragment, e.g. "Free until 14:00". */
  label: string;
}

export interface Hours {
  businessHoursStart: string;
  businessHoursEnd: string;
  /** 0 = Sunday. */
  businessDays: readonly number[];
}

const covers = (b: { start: Date; end: Date }, t: Date) => b.start <= t && t < b.end;

/**
 * What a resource is doing now, and until when. Held bookings and
 * maintenance come from availability; opening hours from the resource.
 */
export function todaySummary(busy: readonly BusyInterval[], hours: Hours, now: Date): TodaySummary {
  const day = istDayKey(now);
  const intervals = busy
    .map((b) => ({ kind: b.kind, start: new Date(b.start), end: new Date(b.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const maintenance = intervals.find((b) => b.kind === "maintenance" && covers(b, now));
  if (maintenance) return { state: "maintenance", label: `Maintenance until ${untilLabel(maintenance.end, day)}` };

  if (!hours.businessDays.includes(weekday(day))) return { state: "closed", label: "Closed today" };
  const opens = atMinute(day, parseHhmm(hours.businessHoursStart));
  const closes = atMinute(day, parseHhmm(hours.businessHoursEnd));
  if (now >= closes) return { state: "closed", label: "Closed for the day" };

  const inUse = intervals.find((b) => b.kind === "booking" && covers(b, now));
  if (inUse) {
    // Back-to-back bookings read as one stretch.
    let end = inUse.end;
    for (const b of intervals) if (b.start <= end && b.end > end) end = b.end;
    return { state: "in-use", label: `In use until ${untilLabel(end, day)}` };
  }

  if (now < opens) return { state: "opens-later", label: `Opens at ${formatTime(opens)}` };
  const next = intervals.find((b) => b.start > now && b.start < closes);
  return next
    ? { state: "free", label: `Free until ${formatTime(next.start)}` }
    : { state: "free", label: "Free for the rest of the day" };
}

/** "14:00", or "later than today" when it runs past midnight. */
function untilLabel(end: Date, day: string): string {
  return istDayKey(new Date(end.getTime() - 1)) === day ? formatTime(end) : "later than today";
}
