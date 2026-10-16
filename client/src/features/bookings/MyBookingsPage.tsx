import { CalendarPlus, History, Repeat } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, ConfirmDialog, EmptyState, ICON_STROKE, PageHeader, Skeleton, StatusPill, Tabs, useToast } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { useNow } from "../../lib/use-now";
import { formatPeriod } from "../calendar/format";
import { CalendarFeed } from "./CalendarFeed";
import { ListRow } from "./ListRow";
import { bookingReason, canCancel, displayStatus, PAST_WINDOW_DAYS, splitByTime, type Reason } from "./reasons";
import { WaitlistPanel } from "./WaitlistPanel";
import type { Booking } from "./types";
import { useBookingDetails, useCancelBooking, usePastBookings, useResourceNames, useUpcomingBookings } from "./use-bookings";

type Tab = "upcoming" | "past" | "waitlist";

/** §11 my bookings: upcoming and past, cancel, why the system ended one, the waitlist, and the calendar feed. */
export default function MyBookingsPage() {
  const [loadedAt] = useState(() => new Date());
  const now = useNow(30_000);
  const [tab, setTab] = useState<Tab>("upcoming");
  const upcoming = useUpcomingBookings(loadedAt);
  const past = usePastBookings(loadedAt);

  // A booking that ends while the page is open moves to Past.
  const pastRows = past.data?.pages.flatMap((p) => p.bookings) ?? [];
  const split = splitByTime([...(upcoming.data ?? []), ...pastRows], now);
  const rows = tab === "upcoming" ? split.upcoming : split.past;
  const query = tab === "past" ? past : upcoming;
  const truncated = past.data?.pages.some((p) => p.truncated) ?? false;
  const pastDays = (past.data?.pages.length ?? 1) * PAST_WINDOW_DAYS;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col">
        <PageHeader title="My bookings" description="What you have booked, what has happened to it, and what you are waiting for." />

        <Tabs<Tab>
          label="Bookings"
          idPrefix="bookings"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "upcoming", label: "Upcoming", meta: upcoming.data ? split.upcoming.length : undefined },
            { id: "past", label: "Past" },
            { id: "waitlist", label: "Waitlist" },
          ]}
        />

        <div role="tabpanel" id={`bookings-panel-${tab}`} aria-labelledby={`bookings-tab-${tab}`}>
          {tab === "waitlist" ? (
            <WaitlistPanel />
          ) : query.isError ? (
            <p role="alert" className="py-4 text-body text-danger-text">
              {describeApiError(query.error)}
            </p>
          ) : query.isPending ? (
            <RowsSkeleton />
          ) : rows.length === 0 ? (
            tab === "upcoming" ? (
              <EmptyState
                icon={CalendarPlus}
                title="Nothing booked yet"
                action={
                  <Link
                    to="/resources"
                    className="inline-flex min-h-11 items-center rounded-control bg-primary px-4 text-body font-medium text-on-cobalt hover:bg-primary-strong md:min-h-9"
                  >
                    Find a resource
                  </Link>
                }
              >
                Open a lab, room or piece of equipment and drag on its calendar to book a time. Your bookings show up here.
              </EmptyState>
            ) : (
              <EmptyState icon={History} title={`Nothing in the last ${pastDays} days`}>
                Older bookings load {PAST_WINDOW_DAYS} days at a time, below.
              </EmptyState>
            )
          ) : (
            <BookingList rows={rows} />
          )}
          {tab === "past" && past.data && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 text-small text-ink-muted">
              <span>
                Showing the last {pastDays} days
                {truncated && " (some windows hit the 200-booking limit, so a few may be missing)"}.
              </span>
              <Button onClick={() => void past.fetchNextPage()} disabled={past.isFetchingNextPage}>
                {past.isFetchingNextPage ? "Loading…" : `Load ${PAST_WINDOW_DAYS} more days`}
              </Button>
            </div>
          )}
        </div>
      </div>

      <CalendarFeed />
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div role="status" aria-label="Loading bookings" className="flex flex-col divide-y divide-line">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-2 py-4 lg:grid-cols-[11.75rem_minmax(0,1fr)_8.5rem_9.5rem]">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-20 max-md:hidden" />
        </div>
      ))}
    </div>
  );
}

function BookingList({ rows }: { rows: Booking[] }) {
  const details = useBookingDetails(rows);
  const resourceName = useResourceNames();
  const cancel = useCancelBooking();
  const toast = useToast();
  const [cancelling, setCancelling] = useState<Booking | null>(null);

  const closeConfirm = () => {
    setCancelling(null);
    cancel.reset();
  };

  return (
    <>
      <ul className="flex flex-col divide-y divide-line border-b border-line">
        {rows.map((b) => {
          const detail = details.get(b.id);
          const reason = detail ? bookingReason(detail) : null;
          return (
            <ListRow
              key={b.id}
              start={new Date(b.start)}
              end={new Date(b.end)}
              resourceId={b.resourceId}
              resourceName={resourceName(b.resourceId)}
              status={<StatusPill status={displayStatus(b, reason)} />}
              details={
                <>
                  <span className="text-ink">{b.purpose || <span className="text-ink-faint">No purpose given</span>}</span>
                  {b.seriesId && (
                    <Link
                      to={`/series/${b.seriesId}`}
                      className="ml-2 inline-flex items-center gap-1 rounded-chip border border-st-approved-border bg-cobalt-tint px-1.5 align-[1px] text-meta font-medium text-st-approved-fg hover:underline"
                      aria-label="Repeats weekly: open the series"
                    >
                      <Repeat aria-hidden="true" size={12} strokeWidth={ICON_STROKE} />
                      Repeats
                    </Link>
                  )}
                  {reason && <ReasonText reason={reason} />}
                </>
              }
              action={
                canCancel(b.status) ? (
                  <Button variant="quiet-danger" onClick={() => setCancelling(b)} className="-ml-3 px-3 lg:ml-0">
                    Cancel booking
                  </Button>
                ) : undefined
              }
            />
          );
        })}
      </ul>

      <ConfirmDialog
        open={cancelling !== null}
        onClose={closeConfirm}
        title="Cancel booking?"
        description={
          cancelling
            ? `${resourceName(cancelling.resourceId)}, ${formatPeriod(new Date(cancelling.start), new Date(cancelling.end))}. The time is freed for other people, and this can't be undone.`
            : ""
        }
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        danger
        busy={cancel.isPending}
        onConfirm={() => {
          if (!cancelling) return;
          cancel.mutate(cancelling.id, {
            onSuccess: () => {
              closeConfirm();
              toast("Booking cancelled.");
            },
          });
        }}
      >
        {cancel.isError && (
          <p role="alert" className="text-body text-danger-text">
            {describeApiError(cancel.error)}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

function ReasonText({ reason }: { reason: Reason }) {
  const text =
    reason.kind === "maintenance"
      ? `Cancelled automatically: maintenance ${formatPeriod(reason.start, reason.end)}${reason.reason ? ` (${reason.reason})` : ""}.`
      : reason.kind === "expired"
        ? "Expired: no approver decided before the start time."
        : `Rejected at approval level ${reason.level}${reason.comment ? `: “${reason.comment}”` : "."}`;
  return <span className="mt-1 block text-small text-ink-muted">{text}</span>;
}
