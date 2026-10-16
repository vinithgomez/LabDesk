import { LineChart } from "lucide-react";
import { useState } from "react";
import { EmptyState, Field, PageHeader, Select } from "../../components/ui";
import { ANALYTICS_ROLES, useMe } from "../auth/use-me";
import { windowLabel } from "./format";
import { Heatmap } from "./Heatmap";
import { IdleRanking } from "./IdleRanking";
import { NoShowTable } from "./NoShowTable";
import { Panel } from "./Panel";
import { SummaryStrip } from "./SummaryStrip";
import { UtilizationBars } from "./UtilizationBars";
import { useDepartments, useHeatmap, useIdleRanking, useNoShows, useUtilization, type AnalyticsFilter } from "./use-analytics";

const RANGES = [4, 8, 12] as const;

/**
 * §11 analytics (DESIGN.md §6): one summary strip, then the day-hour
 * heatmap, utilization by resource, the idle ranking and the no-shows.
 */
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
      <p role="status" className="text-body text-ink-muted">
        Loading…
      </p>
    );
  }
  if (!isStaff) {
    return (
      <div role="alert">
        <EmptyState icon={LineChart} title="Analytics are for staff">
          Analytics are available to faculty, lab in-charges and admins.
        </EmptyState>
      </div>
    );
  }

  const scopeName =
    filter.department === "all"
      ? "All departments"
      : (departments.data?.find((d) => d.id === filter.department) ?? me.data?.department)?.name;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-6">
        <PageHeader
          className="pb-0"
          title="Analytics"
          description={
            <>
              {scopeName}
              {utilization.data && <>, {windowLabel(utilization.data.window)}</>}.
            </>
          }
          actions={
            <>
              {isAdmin && (
                <Field label="Department" className="w-56 max-md:w-full">
                  {(control) => (
                    <Select
                      {...control}
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
                    </Select>
                  )}
                </Field>
              )}
              <Field label="Period" className="w-40 max-md:w-full">
                {(control) => (
                  <Select {...control} value={filter.weeks} onChange={(e) => setFilter((f) => ({ ...f, weeks: Number(e.target.value) }))}>
                    {RANGES.map((w) => (
                      <option key={w} value={w}>
                        Last {w} weeks
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          }
        />
        <SummaryStrip utilization={utilization.data} noShows={noShows.data} />
      </div>

      <Panel
        title="When resources are booked"
        description="Booked hours by day and hour (India Standard Time), summed over the period. Cancelled and rejected bookings are left out."
        query={heatmap}
      >
        {(data) => <Heatmap report={data} />}
      </Panel>

      <Panel
        title="Utilization by resource"
        description="Checked-in time within each resource's business hours and days, as a share of them. Use outside those hours is shown but not counted."
        query={utilization}
      >
        {(data) => <UtilizationBars report={data} />}
      </Panel>

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-2">
        <Panel title="Idle ranking" description="Least used first. A resource needs 4 weeks of data in the period to be ranked." query={idle}>
          {(data) => <IdleRanking report={data} />}
        </Panel>
        <Panel
          title="No-shows"
          description="The share of attendance outcomes that were no-shows. Rejected, expired and cancelled bookings don't count either way."
          query={noShows}
        >
          {(data) => <NoShowTable report={data} />}
        </Panel>
      </div>
    </div>
  );
}
