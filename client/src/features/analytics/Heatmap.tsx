import { hours } from "./format";
import { buildHeatmapGrid, cellShade, HEATMAP_DAYS, hourLabel } from "./heatmap-grid";
import type { HeatmapReport } from "./types";

/**
 * Day x hour grid of booked time (IST). A real table, so screen readers can
 * move by row and column; every cell carries its figures as text.
 */
export function Heatmap({ report }: { report: HeatmapReport }) {
  const grid = buildHeatmapGrid(report.cells);
  const peakDay = grid.peak ? HEATMAP_DAYS.find((d) => d.dow === grid.peak?.dow) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-300">
        {grid.peak && peakDay ? (
          <>
            Busiest hour: <strong className="text-white">{peakDay.long} {hourLabel(grid.peak.hour)}</strong>, with{" "}
            {hours(grid.peak.bookedMinutes)} booked across {grid.peak.bookings} booking{grid.peak.bookings === 1 ? "" : "s"}.
          </>
        ) : (
          "Nothing was booked in this period."
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-xs">
          <caption className="sr-only">Booked hours by day of week and hour of day, India Standard Time</caption>
          <thead>
            <tr>
              <th scope="col" className="w-12">
                <span className="sr-only">Day</span>
              </th>
              {grid.hours.map((h) => (
                <th key={h} scope="col" className="min-w-8 font-normal text-slate-400">
                  {String(h).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HEATMAP_DAYS.map((day) => (
              <tr key={day.dow}>
                <th scope="row" className="pr-2 text-left font-medium text-slate-300">
                  {day.short}
                </th>
                {grid.hours.map((h) => {
                  const c = grid.cell(day.dow, h);
                  const text = `${day.long} ${hourLabel(h)}: ${hours(c.bookedMinutes)} booked, ${c.bookings} booking${c.bookings === 1 ? "" : "s"}`;
                  return (
                    <td key={h} title={text} className="h-8 rounded-md" style={{ backgroundColor: cellShade(c.bookedMinutes, grid.max) }}>
                      <span className="sr-only">{text}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-400" aria-hidden="true">
        <span>Less</span>
        <span
          className="h-3 w-40 rounded-full"
          style={{ background: `linear-gradient(to right, ${cellShade(1, 100)}, ${cellShade(100, 100)})` }}
        />
        <span>More{grid.max > 0 ? ` (${hours(grid.max)} in the busiest hour)` : ""}</span>
      </div>
    </div>
  );
}
