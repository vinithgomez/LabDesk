import { Hourglass } from "lucide-react";
import { useState } from "react";
import { Button, ConfirmDialog, EmptyState, Skeleton, StatusPill, useToast } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { formatPeriod } from "../calendar/format";
import { ListRow } from "./ListRow";
import { WAITLIST_STATUS } from "./status";
import type { WaitlistEntry } from "./types";
import { useLeaveWaitlist, useMyWaitlist, useResourceNames } from "./use-bookings";

/** My waitlist entries: what I'm waiting for, what became a booking, and leaving. */
export function WaitlistPanel() {
  const entries = useMyWaitlist();
  const resourceName = useResourceNames();
  const leave = useLeaveWaitlist();
  const toast = useToast();
  const [leaving, setLeaving] = useState<WaitlistEntry | null>(null);

  const closeConfirm = () => {
    setLeaving(null);
    leave.reset();
  };

  if (entries.isError) {
    return (
      <p role="alert" className="py-4 text-body text-danger-text">
        {describeApiError(entries.error)}
      </p>
    );
  }
  if (entries.isPending) {
    return (
      <div role="status" aria-label="Loading the waitlist" className="flex flex-col gap-3 py-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
    );
  }
  if (entries.data.length === 0) {
    return (
      <EmptyState icon={Hourglass} title="You aren't waiting for anything">
        When a time you want is already taken, the calendar offers to put you on its waitlist. If it frees up, it is booked for you.
      </EmptyState>
    );
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-line border-b border-line">
        {entries.data.map((e) => {
          const state = WAITLIST_STATUS[e.status];
          return (
            <ListRow
              key={e.id}
              start={new Date(e.desiredPeriod.start)}
              end={new Date(e.desiredPeriod.end)}
              resourceId={e.resourceId}
              resourceName={resourceName(e.resourceId)}
              status={<StatusPill status={state.look} label={state.label} />}
              details={
                <>
                  <span className="text-ink">{e.purpose || <span className="text-ink-faint">No purpose given</span>}</span>
                  {e.status === "promoted" && <span className="mt-1 block text-small text-ink-muted">It&apos;s in your upcoming bookings.</span>}
                  {e.status === "expired" && (
                    <span className="mt-1 block text-small text-ink-muted">The time passed without a slot freeing up.</span>
                  )}
                </>
              }
              action={
                e.status === "waiting" ? (
                  <Button variant="quiet-danger" onClick={() => setLeaving(e)} className="-ml-3 px-3 lg:ml-0">
                    Leave
                  </Button>
                ) : undefined
              }
            />
          );
        })}
      </ul>

      <ConfirmDialog
        open={leaving !== null}
        onClose={closeConfirm}
        title="Leave the waitlist?"
        description={
          leaving
            ? `${resourceName(leaving.resourceId)}, ${formatPeriod(new Date(leaving.desiredPeriod.start), new Date(leaving.desiredPeriod.end))}. If the time frees up, it won't be booked for you.`
            : ""
        }
        confirmLabel="Leave the waitlist"
        cancelLabel="Keep waiting"
        danger
        busy={leave.isPending}
        onConfirm={() => {
          if (!leaving) return;
          leave.mutate(leaving.id, {
            onSuccess: () => {
              closeConfirm();
              toast("You've left the waitlist.");
            },
          });
        }}
      >
        {leave.isError && (
          <p role="alert" className="text-body text-danger-text">
            {describeApiError(leave.error)}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
