import { ArrowLeft, CalendarX } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, ConfirmDialog, EmptyState, ICON_STROKE, Skeleton, StatusPill, useToast } from "../../components/ui";
import { describeApiError, describeSkipReason, formatDuration } from "../../lib/api-errors";
import { formatPeriod } from "../calendar/format";
import { useResource } from "../resources/use-resources";
import { describeRrule } from "./rrule";
import { CANCEL_SERIES_WARNING, useCancelSeries, useSeries } from "./use-series";

/** /series/:id: a repeating booking's dates, the ones skipped and why, and cancelling it. */
export default function SeriesPage() {
  const { id } = useParams();
  const series = useSeries(id);
  const resource = useResource(series.data?.resourceId);
  const cancel = useCancelSeries();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const closeConfirm = () => {
    setConfirming(false);
    cancel.reset();
  };

  if (series.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <BackLink />
        <p role="alert" className="text-body text-danger-text">
          {describeApiError(series.error)}
        </p>
      </div>
    );
  }
  if (!series.data) {
    return (
      <div role="status" aria-label="Loading the repeating booking" className="flex flex-col gap-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
    );
  }
  const s = series.data;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <BackLink />
        {/* Its own heading, visible on phones too (the top bar only says "My bookings"). */}
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <h1 className="text-h2 font-semibold text-ink md:text-h1">
            Repeating booking{resource.data && <> · {resource.data.name}</>}
          </h1>
          {s.status === "active" && (
            // The booker, the resource's owners and admins can cancel; anyone who can see it here is one of them.
            <Button onClick={() => setConfirming(true)}>
              Cancel series…
            </Button>
          )}
        </header>
        <div className="flex flex-col gap-1.5">
          <p className="text-lead text-ink">
            {describeRrule(s.rrule) ?? s.rrule}, {s.startTime} for {formatDuration(s.durationMinutes)} (IST)
          </p>
          <p className="text-body text-ink-muted">
            {s.purpose ? `${s.purpose}, for ` : "For "}
            {s.attendeeCount} {s.attendeeCount === 1 ? "person" : "people"}.
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-small text-ink-muted">
            {s.status === "cancelled" ? <StatusPill status="cancelled" /> : <Badge tone="cobalt">Active</Badge>}
            {s.materializedThrough && s.status === "active" && (
              <span>Dates are booked up to the resource&apos;s booking window, and more are added each night.</span>
            )}
          </div>
        </div>
      </div>

      <section aria-labelledby="occ-heading" className="flex flex-col gap-2">
        <h2 id="occ-heading" className="text-h3 font-semibold text-ink">
          Booked dates <span className="text-body font-normal text-ink-muted tabular-nums">{s.occurrences.length}</span>
        </h2>
        {s.occurrences.length === 0 ? (
          <EmptyState icon={CalendarX} title="No dates booked yet">
            {s.status === "active"
              ? "Dates within the resource's booking window are booked as they come into range."
              : "This repeating booking was cancelled before any date was booked."}
          </EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {s.occurrences.map((o) => (
              <li key={o.bookingId} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-body text-ink tabular-nums">{formatPeriod(new Date(o.start), new Date(o.end))}</span>
                <StatusPill status={o.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {s.skipped.length > 0 && (
        <section aria-labelledby="skip-heading" className="flex flex-col gap-1.5">
          <h2 id="skip-heading" className="text-body font-semibold text-ink-muted">
            Skipped dates <span className="font-normal tabular-nums">{s.skipped.length}</span>
          </h2>
          <p className="text-small text-ink-muted">These weren&apos;t booked, and won&apos;t be retried if they free up.</p>
          <ul className="flex flex-col gap-1.5 border-l-2 border-line pl-3">
            {s.skipped.map((k) => (
              <li key={k.start} className="flex flex-col text-small sm:flex-row sm:gap-3">
                <span className="text-ink-muted tabular-nums sm:w-48 sm:shrink-0">{formatPeriod(new Date(k.start), new Date(k.end))}</span>
                <span className="text-ink-faint">{describeSkipReason(k.reason)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={closeConfirm}
        title="Cancel the series?"
        description={CANCEL_SERIES_WARNING}
        confirmLabel="Cancel the series"
        cancelLabel="Keep it"
        danger
        busy={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(s.id, {
            onSuccess: () => {
              closeConfirm();
              toast("Series cancelled.");
            },
          })
        }
      >
        {cancel.isError && (
          <p role="alert" className="text-body text-danger-text">
            {describeApiError(cancel.error)}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/bookings" className="inline-flex items-center gap-1.5 text-small text-ink-muted underline-offset-4 hover:text-ink hover:underline">
      <ArrowLeft aria-hidden="true" size={14} strokeWidth={ICON_STROKE} />
      My bookings
    </Link>
  );
}
