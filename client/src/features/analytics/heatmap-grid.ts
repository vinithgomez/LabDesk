import type { HeatmapCell } from "./types";

/** Rows Monday first, as a week reads on a timetable. dow uses 0 = Sunday. */
export const HEATMAP_DAYS: readonly { dow: number; short: string; long: string }[] = [
  { dow: 1, short: "Mon", long: "Monday" },
  { dow: 2, short: "Tue", long: "Tuesday" },
  { dow: 3, short: "Wed", long: "Wednesday" },
  { dow: 4, short: "Thu", long: "Thursday" },
  { dow: 5, short: "Fri", long: "Friday" },
  { dow: 6, short: "Sat", long: "Saturday" },
  { dow: 0, short: "Sun", long: "Sunday" },
];

export interface HeatmapGrid {
  /** The hour columns shown: every hour with bookings, and at least 08–18. */
  hours: number[];
  /** Looks up a cell; the server sends all 168, so this always finds one. */
  cell(dow: number, hour: number): HeatmapCell;
  /** The busiest cell's booked minutes (for shading); 0 when nothing was booked. */
  max: number;
  /** The busiest cell, or null when nothing was booked. */
  peak: HeatmapCell | null;
}

const EMPTY = (dow: number, hour: number): HeatmapCell => ({ dow, hour, bookedMinutes: 0, bookings: 0 });

/**
 * Arranges the server's zero-filled cells for display. Hours outside every
 * booking are trimmed from the edges (never from the middle) so the grid
 * stays readable on a laptop without hiding any booked time.
 */
export function buildHeatmapGrid(cells: readonly HeatmapCell[]): HeatmapGrid {
  const byKey = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const booked = cells.filter((c) => c.bookedMinutes > 0);
  const first = Math.min(8, ...booked.map((c) => c.hour));
  const last = Math.max(18, ...booked.map((c) => c.hour));
  const peak = booked.reduce<HeatmapCell | null>((best, c) => (best === null || c.bookedMinutes > best.bookedMinutes ? c : best), null);
  return {
    hours: Array.from({ length: last - first + 1 }, (_, i) => first + i),
    cell: (dow, hour) => byKey.get(`${dow}:${hour}`) ?? EMPTY(dow, hour),
    max: peak?.bookedMinutes ?? 0,
    peak,
  };
}

/** Steps on the heatmap's single-hue ramp (--heat-1 … --heat-5). */
export const HEAT_STEPS = 5;

/**
 * A cell's step on the ramp: 0 for an empty cell (drawn as an outline), else
 * 1 to HEAT_STEPS, growing with booked time relative to the busiest cell.
 */
export function heatStep(bookedMinutes: number, max: number): number {
  if (bookedMinutes <= 0 || max <= 0) return 0;
  return Math.min(HEAT_STEPS, Math.max(1, Math.ceil((bookedMinutes / max) * HEAT_STEPS)));
}

export const hourLabel = (h: number): string => `${String(h).padStart(2, "0")}:00`;
