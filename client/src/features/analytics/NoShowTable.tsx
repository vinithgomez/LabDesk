import { cn } from "../../components/ui";
import { percent } from "./format";
import type { NoShowReport } from "./types";

const SHOWN = 8;
/** A rate at or above this is marked (in text as well as colour). */
const HIGH = 0.2;

/** People with the highest no-show rate (the server's order), as a table. */
export function NoShowTable({ report }: { report: NoShowReport }) {
  if (report.byUser.length === 0) return <p className="text-body text-ink-muted">No attended or missed bookings in this period.</p>;
  const rows = report.byUser.slice(0, SHOWN);
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-left text-body">
        <caption className="sr-only">No-shows by person, highest rate first</caption>
        <thead>
          <tr className="border-b border-line bg-sunken text-small text-ink-muted">
            <th scope="col" className="px-3 py-2 font-medium">Person</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">No-shows</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const high = (u.rate ?? 0) >= HIGH;
            return (
              <tr key={u.userId} className="border-b border-line">
                <td className="px-3 py-2.5 text-ink">
                  {u.fullName}
                  {u.rollNo && <span className="ml-2 text-small text-ink-muted tabular-nums">{u.rollNo}</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed whitespace-nowrap text-ink-muted tabular-nums">
                  {u.noShows} of {u.outcomes}
                </td>
                <td className={cn("px-3 py-2.5 text-right font-condensed font-semibold whitespace-nowrap tabular-nums", high ? "text-danger-text" : "text-ink")}>
                  {percent(u.rate)}
                  {high && <span className="ml-1.5 font-sans text-small font-medium">High</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
