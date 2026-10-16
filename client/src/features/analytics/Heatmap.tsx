import { cn } from "../../components/ui";
import { hours } from "./format";
import { buildHeatmapGrid, HEAT_STEPS, heatStep, HEATMAP_DAYS, hourLabel } from "./heatmap-grid";
import type { HeatmapReport } from "./types";

/** Tailwind classes for each step on the single-hue ramp; 0 is an empty, outlined cell. */
const STEP_CLASS = ["border border-line bg-surface", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

/**
 * Day x hour grid of booked time (IST), in the single-hue cobalt ramp of
 * both themes. A real table, so screen readers can move by row and column;
 * every cell carries its figures as text.
 */
export function Heatmap({ report }: { report: HeatmapReport }) {
  const grid = buildHeatmapGrid(report.cells);
  const peakDay = grid.peak ? HEATMAP_DAYS.find((d) => d.dow === grid.peak?.dow) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-ink-muted">
        {grid.peak && peakDay ? (
          <>
            Busiest hour:{" "}
            <strong className="font-semibold text-ink">
              {peakDay.long} {hourLabel(grid.peak.hour)}
            </strong>
            , with {hours(grid.peak.bookedMinutes)} booked across {grid.peak.bookings} booking{grid.peak.bookings === 1 ? "" : "s"}.
          </>
        ) : (
          "Nothing was booked in this period."
        )}
      </p>
      {/* relative: the cells' screen-reader text is absolutely positioned and must stay inside the scroll box. */}
      <div className="relative -mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[34rem] border-separate border-spacing-[3px] text-meta">
          <caption className="sr-only">Booked hours by day of week and hour of day, India Standard Time</caption>
          <thead>
            <tr>
              <th scope="col" className="w-10">
                <span className="sr-only">Day</span>
              </th>
              {grid.hours.map((h) => (
                <th key={h} scope="col" className="min-w-6 pb-1 font-condensed font-normal text-ink-muted tabular-nums">
                  {String(h).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HEATMAP_DAYS.map((day) => (
              <tr key={day.dow}>
                <th scope="row" className="pr-2 text-left text-small font-medium text-ink-muted">
                  {day.short}
                </th>
                {grid.hours.map((h) => {
                  const c = grid.cell(day.dow, h);
                  const text = `${day.long} ${hourLabel(h)}: ${hours(c.bookedMinutes)} booked, ${c.bookings} booking${c.bookings === 1 ? "" : "s"}`;
                  return (
                    <td key={h} title={text} className={cn("h-7 rounded-chip", STEP_CLASS[heatStep(c.bookedMinutes, grid.max)])}>
                      <span className="sr-only">{text}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-small text-ink-muted" aria-hidden="true">
        <span className="mr-1">None</span>
        <span className={cn("size-4 rounded-chip", STEP_CLASS[0])} />
        <span className="ml-3 mr-1">Less</span>
        {Array.from({ length: HEAT_STEPS }, (_, i) => (
          <span key={i} className={cn("size-4 rounded-chip", STEP_CLASS[i + 1])} />
        ))}
        <span className="ml-1">More{grid.max > 0 ? ` (${hours(grid.max)} in the busiest hour)` : ""}</span>
      </div>
    </div>
  );
}
