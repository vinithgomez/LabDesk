import { days, hours, percent } from "./format";
import type { IdleRankingReport } from "./types";

/** Least-used resources first, as a table; resources that couldn't be ranked are listed with the reason. */
export function IdleRanking({ report }: { report: IdleRankingReport }) {
  return (
    <div className="flex flex-col gap-4">
      {report.ranked.length === 0 ? (
        <p className="text-body text-ink-muted">No resource has {report.minimumDays} days of data in this period yet.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-left text-body">
            <caption className="sr-only">Idle ranking, least used first</caption>
            <thead>
              <tr className="border-b border-line bg-sunken text-small text-ink-muted">
                <th scope="col" className="w-10 px-3 py-2 font-medium">#</th>
                <th scope="col" className="px-3 py-2 font-medium">Resource</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Utilization</th>
                <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">Used of open</th>
              </tr>
            </thead>
            <tbody>
              {report.ranked.map((r) => (
                <tr key={r.resourceId} className="border-b border-line">
                  <td className="px-3 py-2.5 font-condensed text-ink-muted tabular-nums">{r.rank}</td>
                  <td className="px-3 py-2.5 text-ink">{r.name}</td>
                  <td className="px-3 py-2.5 text-right font-condensed font-semibold text-ink tabular-nums">{percent(r.utilization)}</td>
                  <td className="px-3 py-2.5 text-right font-condensed whitespace-nowrap text-ink-muted tabular-nums">
                    {hours(r.inHoursMinutes)} of {hours(r.availableMinutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report.excluded.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-small font-semibold text-ink-muted">Not ranked</h3>
          <ul className="flex flex-col gap-1 border-l-2 border-line pl-3 text-small text-ink-muted">
            {report.excluded.map((e) => (
              <li key={e.resourceId}>
                <span className="font-medium text-ink">{e.name}</span>: {e.message}
                {e.reason === "INSUFFICIENT_DATA" && <span className="sr-only"> ({days(e.observedDays)} observed)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
