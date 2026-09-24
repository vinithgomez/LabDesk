import { hours, percent } from "./format";
import type { NoShowReport, UtilizationReport } from "./types";

function Card({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <dt className="text-sm font-medium text-slate-400">{label}</dt>
      <dd className="text-3xl font-bold tracking-tight text-white">{value}</dd>
      <dd className="text-sm text-slate-400">{detail}</dd>
    </div>
  );
}

/** The four headline figures. Either report may still be loading. */
export function MetricCards({ utilization, noShows }: { utilization?: UtilizationReport; noShows?: NoShowReport }) {
  const t = utilization?.totals;
  const o = noShows?.overall;
  const pending = "…";
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="Utilization"
        value={t ? percent(t.utilization) : pending}
        detail="Checked-in time within business hours, as a share of them"
      />
      <Card label="Hours booked" value={t ? hours(t.bookedMinutes) : pending} detail={t ? `${t.bookings.toLocaleString()} bookings` : ""} />
      <Card
        label="Hours used"
        value={t ? hours(t.actualMinutes) : pending}
        detail={t ? `${hours(t.offHoursMinutes)} of it outside business hours, not in utilization` : ""}
      />
      <Card
        label="No-show rate"
        value={o ? percent(o.rate) : pending}
        detail={o ? `${o.noShows} of ${o.outcomes} attendance outcomes` : ""}
      />
    </dl>
  );
}
