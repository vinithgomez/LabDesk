import { useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../../lib/api-errors";
import { formatPeriod } from "../calendar/format";
import { WAITLIST_STATUS } from "./status";
import { ToneBadge } from "./StatusBadge";
import type { WaitlistEntry } from "./types";
import { useLeaveWaitlist, useMyWaitlist, useResourceNames } from "./use-bookings";

const smallButton =
  "min-h-7 rounded px-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50";

/** My waitlist entries: what I'm waiting for, what became a booking, and leaving. */
export function WaitlistPanel() {
  const entries = useMyWaitlist();
  const resourceName = useResourceNames();

  if (entries.isError) {
    return (
      <p role="alert" className="rounded-md bg-rose-600/20 p-2 text-sm text-rose-200">
        {describeApiError(entries.error)}
      </p>
    );
  }
  if (entries.isPending) return <p className="text-sm text-slate-400">Loading…</p>;
  if (entries.data.length === 0) {
    return (
      <p className="py-2 text-sm text-slate-400">
        You aren't waiting for anything. When a time you want is taken, the calendar offers the waitlist.
      </p>
    );
  }

  return (
    <div className="relative overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Wanted (IST)</th>
            <th scope="col" className="px-3 py-2 font-medium">Resource</th>
            <th scope="col" className="px-3 py-2 font-medium">Purpose</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {entries.data.map((e) => (
            <tr key={e.id} className="align-top">
              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-200">
                {formatPeriod(new Date(e.desiredPeriod.start), new Date(e.desiredPeriod.end))}
              </td>
              <td className="px-3 py-1.5">
                <Link to={`/resources/${e.resourceId}`} className="text-indigo-300 hover:underline">
                  {resourceName(e.resourceId)}
                </Link>
              </td>
              <td className="px-3 py-1.5 text-slate-300">
                {e.purpose || <span className="text-slate-500">—</span>}
                {e.status === "promoted" && <span className="mt-0.5 block text-xs text-slate-400">It's in your upcoming bookings.</span>}
                {e.status === "expired" && <span className="mt-0.5 block text-xs text-slate-400">The time passed without a slot freeing up.</span>}
              </td>
              <td className="px-3 py-1.5">
                <ToneBadge tone={WAITLIST_STATUS[e.status].tone} label={WAITLIST_STATUS[e.status].label} />
              </td>
              <td className="px-3 py-1.5 text-right">{e.status === "waiting" && <LeaveControl entry={e} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaveControl({ entry }: { entry: WaitlistEntry }) {
  const [confirming, setConfirming] = useState(false);
  const leave = useLeaveWaitlist();
  if (leave.isError) {
    return (
      <span role="alert" className="text-xs text-rose-300">
        {describeApiError(leave.error)}
      </span>
    );
  }
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={`${smallButton} border border-slate-600 text-slate-200`}>
        Leave
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5" role="group" aria-label="Confirm leaving the waitlist">
      <span className="text-xs text-slate-300">Stop waiting for this time?</span>
      <button type="button" autoFocus disabled={leave.isPending} onClick={() => leave.mutate(entry.id)} className={`${smallButton} bg-rose-600 text-white`}>
        {leave.isPending ? "Leaving…" : "Leave the waitlist"}
      </button>
      <button type="button" disabled={leave.isPending} onClick={() => setConfirming(false)} className={`${smallButton} text-slate-300`}>
        Keep waiting
      </button>
    </span>
  );
}
