import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../../lib/api-errors";
import { useNow } from "../../lib/use-now";
import { formatPeriod } from "../calendar/format";
import { CalendarFeed } from "./CalendarFeed";
import { bookingReason, canCancel, displayStatus, PAST_WINDOW_DAYS, splitByTime, type Reason } from "./reasons";
import { StatusBadge } from "./StatusBadge";
import type { Booking } from "./types";
import { useBookingDetails, useCancelBooking, usePastBookings, useResourceNames, useUpcomingBookings } from "./use-bookings";

type Tab = "upcoming" | "past";
const TABS: { id: Tab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
];

const smallButton =
  "min-h-7 rounded px-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50";

/** §11 my bookings: upcoming and past, cancel, why the system ended one, and the calendar feed. */
export default function MyBookingsPage() {
  const [loadedAt] = useState(() => new Date());
  const now = useNow(30_000);
  const [tab, setTab] = useState<Tab>("upcoming");
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());
  const upcoming = useUpcomingBookings(loadedAt);
  const past = usePastBookings(loadedAt);

  // A booking that ends while the page is open moves to Past.
  const pastRows = past.data?.pages.flatMap((p) => p.bookings) ?? [];
  const split = splitByTime([...(upcoming.data ?? []), ...pastRows], now);
  const rows = tab === "upcoming" ? split.upcoming : split.past;
  const query = tab === "upcoming" ? upcoming : past;
  const truncated = past.data?.pages.some((p) => p.truncated) ?? false;

  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next: Tab = tab === "upcoming" ? "past" : "upcoming";
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-white">My bookings</h1>

      <section className="flex flex-col gap-2">
        <div role="tablist" aria-label="Bookings" className="flex gap-1 border-b border-slate-800" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current.set(t.id, el);
              }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`-mb-px min-h-9 border-b-2 px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                tab === t.id ? "border-indigo-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
              {t.id === "upcoming" && upcoming.data && <span className="ml-1.5 text-xs text-slate-500">{split.upcoming.length}</span>}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {query.isError ? (
            <p role="alert" className="rounded-md bg-rose-600/20 p-2 text-sm text-rose-200">
              {describeApiError(query.error)}
            </p>
          ) : query.isPending ? (
            <p role="status" className="text-sm text-slate-400">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="py-2 text-sm text-slate-400">
              {tab === "upcoming" ? (
                <>
                  Nothing booked. <Link to="/resources" className="text-indigo-300 hover:underline">Find a resource</Link>
                </>
              ) : (
                `Nothing in the last ${(past.data?.pages.length ?? 1) * PAST_WINDOW_DAYS} days.`
              )}
            </p>
          ) : (
            <BookingTable rows={rows} />
          )}
          {tab === "past" && past.data && (
            <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
              <span>
                Showing the last {past.data.pages.length * PAST_WINDOW_DAYS} days
                {truncated && " (some windows hit the 200-booking limit, so a few may be missing)"}.
              </span>
              <button
                type="button"
                onClick={() => void past.fetchNextPage()}
                disabled={past.isFetchingNextPage}
                className={`${smallButton} border border-slate-700 text-slate-200`}
              >
                {past.isFetchingNextPage ? "Loading…" : `Load ${PAST_WINDOW_DAYS} more days`}
              </button>
            </div>
          )}
        </div>
      </section>

      <CalendarFeed />
    </div>
  );
}

function BookingTable({ rows }: { rows: Booking[] }) {
  const details = useBookingDetails(rows);
  const resourceName = useResourceNames();
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">When (IST)</th>
            <th scope="col" className="px-3 py-2 font-medium">Resource</th>
            <th scope="col" className="px-3 py-2 font-medium">Purpose</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((b) => {
            const detail = details.get(b.id);
            const reason = detail ? bookingReason(detail) : null;
            return (
              <tr key={b.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-200">{formatPeriod(new Date(b.start), new Date(b.end))}</td>
                <td className="px-3 py-1.5">
                  <Link to={`/resources/${b.resourceId}`} className="text-indigo-300 hover:underline">
                    {resourceName(b.resourceId)}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-slate-300">
                  {b.purpose || <span className="text-slate-500">—</span>}
                  {reason && <ReasonText reason={reason} />}
                </td>
                <td className="px-3 py-1.5">
                  <StatusBadge status={displayStatus(b, reason)} />
                </td>
                <td className="px-3 py-1.5 text-right">{canCancel(b.status) && <CancelControl booking={b} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReasonText({ reason }: { reason: Reason }) {
  const text =
    reason.kind === "maintenance"
      ? `Cancelled automatically: maintenance ${formatPeriod(reason.start, reason.end)}${reason.reason ? ` (${reason.reason})` : ""}.`
      : reason.kind === "expired"
        ? "Expired: no approver decided before the start time."
        : `Rejected at approval level ${reason.level}${reason.comment ? `: “${reason.comment}”` : "."}`;
  return <span className="mt-0.5 block text-xs text-slate-400">{text}</span>;
}

/** Cancel with a confirm step in place. */
function CancelControl({ booking }: { booking: Booking }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCancelBooking();
  if (cancel.isError) {
    return (
      <span role="alert" className="text-xs text-rose-300">
        {describeApiError(cancel.error)}
      </span>
    );
  }
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={`${smallButton} border border-slate-600 text-slate-200`}>
        Cancel
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5" role="group" aria-label="Confirm cancellation">
      <span className="text-xs text-slate-300">Cancel this booking?</span>
      <button
        type="button"
        autoFocus
        disabled={cancel.isPending}
        onClick={() => cancel.mutate(booking.id)}
        className={`${smallButton} bg-rose-600 text-white`}
      >
        {cancel.isPending ? "Cancelling…" : "Yes, cancel"}
      </button>
      <button type="button" disabled={cancel.isPending} onClick={() => setConfirming(false)} className={`${smallButton} text-slate-300`}>
        Keep
      </button>
    </span>
  );
}
