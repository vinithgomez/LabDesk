import { useState } from "react";
import { ANALYTICS_ROLES, useMe } from "../auth/use-me";
import { windowLabel } from "./format";
import { Heatmap } from "./Heatmap";
import { IdleRanking } from "./IdleRanking";
import { MetricCards } from "./MetricCards";
import { NoShowTable } from "./NoShowTable";
import { Panel } from "./Panel";
import { UtilizationBars } from "./UtilizationBars";
import { useDepartments, useHeatmap, useIdleRanking, useNoShows, useUtilization, type AnalyticsFilter } from "./use-analytics";

const RANGES = [4, 8, 12] as const;

const selectClass =
  "min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400";

/** §11 analytics dashboard: metric cards, the day-hour heatmap, utilization bars, idle ranking, no-shows. */
export default function AnalyticsPage() {
  const me = useMe();
  const isStaff = me.data ? ANALYTICS_ROLES.includes(me.data.role) : false;
  const isAdmin = me.data?.role === "admin";
  const [filter, setFilter] = useState<AnalyticsFilter>({ weeks: 8, department: undefined });

  const utilization = useUtilization(filter, isStaff);
  const noShows = useNoShows(filter, isStaff);
  const heatmap = useHeatmap(filter, isStaff);
  const idle = useIdleRanking(filter, isStaff);
  const departments = useDepartments(isAdmin);

  if (me.isPending) {
    return (
      <p role="status" className="text-slate-300">
        Loading…
      </p>
    );
  }
  if (!isStaff) {
    return (
      <p role="alert" className="rounded-2xl bg-slate-800 p-5 text-slate-200">
        Analytics are available to faculty, lab in-charges and admins.
      </p>
    );
  }

  const scopeName =
    filter.department === "all"
      ? "All departments"
      : (departments.data?.find((d) => d.id === filter.department) ?? me.data?.department)?.name;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Analytics</h1>
          <p className="text-slate-400">
            {scopeName}
            {utilization.data && <> · {windowLabel(utilization.data.window)}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {isAdmin && (
            <label className="flex flex-col gap-1 text-sm text-slate-400">
              Department
              <select
                className={selectClass}
                value={filter.department ?? ""}
                onChange={(e) => setFilter((f) => ({ ...f, department: e.target.value || undefined }))}
              >
                <option value="">My department</option>
                {departments.data
                  ?.filter((d) => d.id !== me.data?.departmentId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                <option value="all">All departments</option>
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm text-slate-400">
            Period
            <select
              className={selectClass}
              value={filter.weeks}
              onChange={(e) => setFilter((f) => ({ ...f, weeks: Number(e.target.value) }))}
            >
              {RANGES.map((w) => (
                <option key={w} value={w}>
                  Last {w} weeks
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <MetricCards utilization={utilization.data} noShows={noShows.data} />

      <Panel
        title="When resources are booked"
        description="Booked hours by day and hour (India Standard Time), summed over the period. Cancelled and rejected bookings are left out."
        query={heatmap}
      >
        {(data) => <Heatmap report={data} />}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Utilization by resource"
          description="Checked-in time within each resource's business hours and days, as a share of them. Use outside those hours is shown but not counted."
          query={utilization}
        >
          {(data) => <UtilizationBars report={data} />}
        </Panel>
        <Panel
          title="Idle ranking"
          description="Least used first. A resource needs 4 weeks of data in the period to be ranked."
          query={idle}
        >
          {(data) => <IdleRanking report={data} />}
        </Panel>
      </div>

      <Panel
        title="No-shows"
        description="No-shows ÷ (no-shows + attended). Rejected, expired and cancelled bookings don't count either way."
        query={noShows}
      >
        {(data) => <NoShowTable report={data} />}
      </Panel>
    </div>
  );
}
