import { Badge } from "../../components/ui";
import { barWidth, hours, percent } from "./format";
import type { UtilizationReport } from "./types";

/** One row per resource, most used first (the server's order): name, a thin bar, the figure, and a plain line of hours. */
export function UtilizationBars({ report }: { report: UtilizationReport }) {
  if (report.resources.length === 0) return <p className="text-body text-ink-muted">No resources in this department.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {report.resources.map((r) => (
        <li key={r.resourceId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3 md:grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)_4rem]">
          <span className="flex min-w-0 items-center gap-2 text-body font-medium text-ink md:col-start-1 md:row-start-1">
            <span className="truncate">{r.name}</span>
            {!r.isActive && <Badge>Inactive</Badge>}
          </span>
          <span className="text-right font-condensed text-lead font-semibold text-ink tabular-nums md:col-start-3 md:row-start-1">
            {percent(r.utilization)}
          </span>
          <div
            className="col-span-2 h-1.5 overflow-hidden rounded-chip bg-sunken md:col-span-1 md:col-start-2 md:row-start-1"
            role="meter"
            aria-label={`${r.name} utilization`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((r.utilization ?? 0) * 100)}
            aria-valuetext={percent(r.utilization)}
          >
            <div className="h-full rounded-chip bg-cobalt" style={{ width: barWidth(r.utilization) }} />
          </div>
          <p className="col-span-2 text-small text-ink-muted md:col-start-2 md:row-start-2">
            {hours(r.inHoursMinutes)} used of {hours(r.availableMinutes)} open; {hours(r.bookedMinutes)} booked.
            {/* Only when it rounds to something: a few stray minutes would read "0.0 h". */}
            {r.offHoursMinutes >= 3 && <> Also {hours(r.offHoursMinutes)} outside business hours, not counted.</>}
          </p>
        </li>
      ))}
    </ul>
  );
}
