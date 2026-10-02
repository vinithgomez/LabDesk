import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { describeApiError, describeSkipReason, formatDuration } from "../../lib/api-errors";
import { StatusBadge } from "../bookings/StatusBadge";
import { formatPeriod } from "../calendar/format";
import { useResource } from "../resources/use-resources";
import { describeRrule } from "./rrule";
import { CANCEL_SERIES_WARNING, useCancelSeries, useSeries } from "./use-series";

const button =
  "min-h-8 rounded-md px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50";

/** /series/:id: a repeating booking's dates, the ones skipped and why, and cancelling it. */
export default function SeriesPage() {
  const { id } = useParams();
  const series = useSeries(id);
  const resource = useResource(series.data?.resourceId);
  const cancel = useCancelSeries();
  const [confirming, setConfirming] = useState(false);

  if (series.isError) {
    return (
      <p role="alert" className="rounded-md bg-rose-600/20 p-2 text-sm text-rose-200">
        {describeApiError(series.error)}
      </p>
    );
  }
  if (!series.data) return <p className="text-sm text-slate-400">Loading…</p>;
  const s = series.data;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Link to="/bookings" className="text-xs text-slate-400 hover:text-slate-200 hover:underline">
          ← My bookings
        </Link>
        <h1 className="text-xl font-bold text-white">
          Repeating booking{resource.data && <> · {resource.data.name}</>}
        </h1>
        <p className="text-sm text-slate-300">
          {describeRrule(s.rrule) ?? s.rrule}, {s.startTime} for {formatDuration(s.durationMinutes)} (IST)
          {s.purpose && <> · {s.purpose}</>} · {s.attendeeCount} {s.attendeeCount === 1 ? "person" : "people"}
        </p>
        <p className="text-xs text-slate-400">
          {s.status === "cancelled" ? "Cancelled" : "Active"}
          {s.materializedThrough && s.status === "active" && " · dates are booked up to the resource's booking window and added nightly"}
        </p>
      </div>

      <section aria-labelledby="occ-heading" className="flex flex-col gap-1.5">
        <h2 id="occ-heading" className="text-sm font-semibold text-white">
          Booked dates <span className="font-normal text-slate-400">{s.occurrences.length}</span>
        </h2>
        {s.occurrences.length === 0 ? (
          <p className="text-sm text-slate-400">None yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-800 rounded-lg border border-slate-800">
            {s.occurrences.map((o) => (
              <li key={o.bookingId} className="flex items-center justify-between gap-2 px-3 py-1 text-sm">
                <span className="tabular-nums text-slate-200">{formatPeriod(new Date(o.start), new Date(o.end))}</span>
                <StatusBadge status={o.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {s.skipped.length > 0 && (
        <section aria-labelledby="skip-heading" className="flex flex-col gap-1.5">
          <h2 id="skip-heading" className="text-sm font-semibold text-white">
            Skipped dates <span className="font-normal text-slate-400">{s.skipped.length}</span>
          </h2>
          <p className="text-xs text-slate-400">These weren't booked, and won't be retried if they free up.</p>
          <ul className="flex flex-col divide-y divide-slate-800 rounded-lg border border-slate-800">
            {s.skipped.map((k) => (
              <li key={k.start} className="flex flex-wrap items-center justify-between gap-x-3 px-3 py-1 text-sm">
                <span className="tabular-nums text-slate-200">{formatPeriod(new Date(k.start), new Date(k.end))}</span>
                <span className="text-slate-400">{describeSkipReason(k.reason)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The booker, the resource's owners and admins can cancel; anyone who can see it here is one of them. */}
      {s.status === "active" && (
        <section className="flex flex-col gap-2">
          {confirming ? (
            <div role="group" aria-label="Confirm cancelling the series" className="flex flex-col gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-2">
              <p className="text-sm text-amber-100">{CANCEL_SERIES_WARNING}</p>
              {cancel.isError && <p className="text-sm text-rose-300">{describeApiError(cancel.error)}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  autoFocus
                  disabled={cancel.isPending}
                  className={`${button} bg-rose-600 text-white`}
                  onClick={() => cancel.mutate(s.id, { onSuccess: () => setConfirming(false) })}
                >
                  {cancel.isPending ? "Cancelling…" : "Cancel the series"}
                </button>
                <button type="button" disabled={cancel.isPending} className={`${button} text-slate-300`} onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button type="button" className={`${button} border border-slate-600 text-slate-200`} onClick={() => setConfirming(true)}>
                Cancel series…
              </button>
            </div>
          )}
        </section>
      )}
      <p aria-live="polite" className="sr-only">
        {cancel.isSuccess ? "Series cancelled." : ""}
      </p>
    </div>
  );
}
