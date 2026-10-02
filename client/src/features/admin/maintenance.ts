/**
 * Maintenance and incident form rules, pure. Date-time inputs hold IST
 * wall-clock text ("2026-10-05T10:00") whatever zone the browser is in.
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { BusyInterval } from "../bookings/types";
import { formatDateTime, formatPeriod } from "../calendar/format";
import { IST, istDayKey } from "../calendar/grid";

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** A datetime-local value read as IST, or null if it isn't one. */
export function istInputToInstant(value: string): Date | null {
  if (!LOCAL.test(value)) return null;
  const instant = fromZonedTime(`${value}:00`, IST);
  // Reject impossible dates (e.g. 2026-02-30) that would silently roll over.
  return Number.isNaN(instant.getTime()) || instantToIstInput(instant) !== value ? null : instant;
}

/** The datetime-local value showing `instant` in IST. */
export function instantToIstInput(instant: Date): string {
  return formatInTimeZone(instant, IST, "yyyy-MM-dd'T'HH:mm");
}

/** "Mon 5 Oct, 10:00–12:00", or across days "Mon 5 Oct, 22:00 – Tue 6 Oct, 06:00". */
export function formatSpan(start: Date, end: Date): string {
  return istDayKey(start) === istDayKey(new Date(end.getTime() - 1))
    ? formatPeriod(start, end)
    : `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

export interface MaintenanceDraft {
  resourceId: string;
  start: string;
  end: string;
  reason: string;
}

export type MaintenanceErrors = Partial<Record<keyof MaintenanceDraft, string>>;

/** The server's rules: a resource, a real window that ends after it starts and in the future, a reason. */
export function validateMaintenance(d: MaintenanceDraft, now: Date): MaintenanceErrors {
  const errors: MaintenanceErrors = {};
  if (!d.resourceId) errors.resourceId = "Choose a resource.";
  const start = istInputToInstant(d.start);
  const end = istInputToInstant(d.end);
  if (!start) errors.start = "Choose when it starts.";
  if (!end) errors.end = "Choose when it ends.";
  else if (start && end <= start) errors.end = "It must end after it starts.";
  else if (end <= now) errors.end = "It must end in the future.";
  if (!d.reason.trim()) errors.reason = "Give a reason: bookers whose bookings it cancels will see it.";
  else if (d.reason.trim().length > 500) errors.reason = "Keep the reason to 500 characters.";
  return errors;
}

/** The availability endpoint answers for at most 31 days at a time. */
export const MAX_PREVIEW_MS = 31 * 86_400_000;

/** Held bookings (the ones a window cancels) that overlap it. */
export function overlappingBookings(busy: readonly BusyInterval[], start: Date, end: Date): number {
  return busy.filter(
    (b) => b.kind === "booking" && new Date(b.start).getTime() < end.getTime() && start.getTime() < new Date(b.end).getTime(),
  ).length;
}

/** The confirm step's warning, in plain words. */
export function maintenanceWarning(resourceName: string, start: Date, end: Date, overlapping: number | null): string {
  const count =
    overlapping === null
      ? ""
      : overlapping === 0
        ? " No bookings overlap it right now."
        : ` ${overlapping} booking${overlapping === 1 ? " overlaps" : "s overlap"} it right now.`;
  return `Every booking on ${resourceName} that overlaps ${formatSpan(start, end)} (pending, approved or in progress) will be cancelled automatically, and its booker will see your reason.${count}`;
}

export type Severity = "minor" | "major" | "out_of_service";
export const SEVERITIES: { value: Severity; label: string }[] = [
  { value: "minor", label: "Minor" },
  { value: "major", label: "Major" },
  { value: "out_of_service", label: "Out of service" },
];

export function validateIncident(d: { resourceId: string; description: string }): Partial<Record<"resourceId" | "description", string>> {
  const errors: Partial<Record<"resourceId" | "description", string>> = {};
  if (!d.resourceId) errors.resourceId = "Choose a resource.";
  if (!d.description.trim()) errors.description = "Describe what happened.";
  else if (d.description.trim().length > 2000) errors.description = "Keep it to 2,000 characters.";
  return errors;
}
