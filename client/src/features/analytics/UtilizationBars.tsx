import { barWidth, hours, percent } from "./format";
import type { UtilizationReport } from "./types";

/** One bar per resource, most used first (the server's order). */
export function UtilizationBars({ report }: { report: UtilizationReport }) {
  if (report.resources.length === 0) return <p className="text-slate-400">No resources in this department.</p>;
  return (
    <ul className="flex flex-col gap-4">
      {report.resources.map((r) => (
        <li key={r.resourceId} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium text-slate-100">
              {r.name}
              {!r.isActive && <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">inactive</span>}
            </span>
            <span className="tabular-nums font-semibold text-white">{percent(r.utilization)}</span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-slate-800"
            role="meter"
            aria-label={`${r.name} utilization`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((r.utilization ?? 0) * 100)}
            aria-valuetext={percent(r.utilization)}
          >
            <div className="h-full rounded-full bg-indigo-500" style={{ width: barWidth(r.utilization) }} />
          </div>
          <p className="text-xs text-slate-400">
            {hours(r.inHoursMinutes)} used · {hours(r.bookedMinutes)} booked · {hours(r.availableMinutes)} open
            {r.offHoursMinutes > 0 && <> · +{hours(r.offHoursMinutes)} outside business hours (not counted)</>}
          </p>
        </li>
      ))}
    </ul>
  );
}
