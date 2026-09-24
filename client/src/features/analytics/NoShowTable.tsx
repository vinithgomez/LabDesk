import { percent } from "./format";
import type { NoShowReport } from "./types";

const SHOWN = 8;

/** People with the highest no-show rate (the server's order). */
export function NoShowTable({ report }: { report: NoShowReport }) {
  if (report.byUser.length === 0) return <p className="text-slate-400">No attended or missed bookings in this period.</p>;
  const rows = report.byUser.slice(0, SHOWN);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate-400">
          <th scope="col" className="pb-2 font-medium">Person</th>
          <th scope="col" className="pb-2 text-right font-medium">No-shows</th>
          <th scope="col" className="pb-2 text-right font-medium">Rate</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800">
        {rows.map((u) => (
          <tr key={u.userId}>
            <td className="py-2 text-slate-100">
              {u.fullName}
              {u.rollNo && <span className="ml-2 text-xs text-slate-500">{u.rollNo}</span>}
            </td>
            <td className="py-2 text-right tabular-nums text-slate-400">
              {u.noShows} of {u.outcomes}
            </td>
            <td className={`py-2 text-right tabular-nums font-semibold ${(u.rate ?? 0) >= 0.2 ? "text-rose-300" : "text-white"}`}>
              {percent(u.rate)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
