import { days, hours, percent } from "./format";
import type { IdleRankingReport } from "./types";

/** Least-used resources first; resources that couldn't be ranked are listed with the reason. */
export function IdleRanking({ report }: { report: IdleRankingReport }) {
  return (
    <div className="flex flex-col gap-4">
      {report.ranked.length === 0 ? (
        <p className="text-slate-400">No resource has {report.minimumDays} days of data in this period yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th scope="col" className="w-10 pb-2 font-medium">#</th>
              <th scope="col" className="pb-2 font-medium">Resource</th>
              <th scope="col" className="pb-2 text-right font-medium">Utilization</th>
              <th scope="col" className="pb-2 text-right font-medium">Used / open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {report.ranked.map((r) => (
              <tr key={r.resourceId}>
                <td className="py-2 tabular-nums text-slate-400">{r.rank}</td>
                <td className="py-2 text-slate-100">{r.name}</td>
                <td className="py-2 text-right tabular-nums font-semibold text-white">{percent(r.utilization)}</td>
                <td className="py-2 text-right tabular-nums text-slate-400">
                  {hours(r.inHoursMinutes)} / {hours(r.availableMinutes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.excluded.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-slate-800/60 p-3">
          <h3 className="text-sm font-semibold text-slate-200">Not ranked</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {report.excluded.map((e) => (
              <li key={e.resourceId} className="text-slate-400">
                <span className="text-slate-200">{e.name}</span> — {e.message}
                {e.reason === "INSUFFICIENT_DATA" && <span className="sr-only"> ({days(e.observedDays)} observed)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
