import type { ReactNode } from "react";
import { cn } from "../../components/ui";
import { hours, percent } from "./format";
import type { NoShowReport, UtilizationReport } from "./types";

/**
 * The four headline figures as one continuous strip, separated by dividers
 * (DESIGN.md §6: not four identical cards). Either report may still be loading.
 */
export function SummaryStrip({ utilization, noShows }: { utilization?: UtilizationReport; noShows?: NoShowReport }) {
  const t = utilization?.totals;
  const o = noShows?.overall;
  return (
    <dl className="grid grid-cols-2 border-y border-line md:grid-cols-4">
      <Figure at={0} label="Utilization" value={t ? percent(t.utilization) : null}>
        Checked-in time within business hours, as a share of them.
      </Figure>
      <Figure at={1} label="Hours booked" value={t ? hours(t.bookedMinutes) : null}>
        {t ? `Across ${t.bookings.toLocaleString()} bookings.` : null}
      </Figure>
      <Figure at={2} label="Hours used" value={t ? hours(t.actualMinutes) : null}>
        {t ? `${hours(t.offHoursMinutes)} of it outside business hours, not in utilization.` : null}
      </Figure>
      <Figure at={3} label="No-show rate" value={o ? percent(o.rate) : null}>
        {o ? `${o.noShows} of ${o.outcomes} attendance outcomes.` : null}
      </Figure>
    </dl>
  );
}

/**
 * One figure: Plex Sans Condensed numerals over a plain label and one line
 * of context. `at` is its place in the strip, which decides its dividers:
 * a 2 x 2 block on phones, one row of four from tablet up.
 */
function Figure({ at, label, value, children }: { at: number; label: string; value: string | null; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-line py-5",
        at % 2 === 1 ? "border-l pl-4" : "pr-4",
        at >= 2 && "border-t md:border-t-0",
        at > 0 ? "md:border-l md:pl-6" : "md:pl-0",
        "md:pr-6",
      )}
    >
      <dt className="text-small font-medium text-ink-muted">{label}</dt>
      <dd className="font-condensed text-h1 leading-none font-semibold text-ink tabular-nums">
        {value ?? <span className="text-ink-faint">…</span>}
      </dd>
      <dd className="text-small text-ink-muted">{children}</dd>
    </div>
  );
}
