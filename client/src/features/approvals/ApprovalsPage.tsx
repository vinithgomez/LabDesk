import { Check, ClipboardCheck, Clock3, TimerOff } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Checkbox, cn, EmptyState, Field, PageHeader, Skeleton, Textarea } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { useNow } from "../../lib/use-now";
import { isStaff, useMe } from "../auth/use-me";
import { formatDate, formatDateTime, formatPeriod, formatTime } from "../calendar/format";
import { availableActions, rejectionCommentError, whyNotDecidable, type InboxItem } from "./model";
import { useApprovalActions, useInbox } from "./use-approvals";

/** §11 approvals inbox: a queue, oldest start first; approve or reject in place. */
export default function ApprovalsPage() {
  const me = useMe();
  // Wait for the role, so the inbox is only asked for by staff.
  if (!me.data) return <p className="text-body text-ink-muted">Loading…</p>;
  if (!isStaff(me.data)) {
    return (
      <EmptyState icon={ClipboardCheck} title="Approvals are for staff">
        The approvals inbox is for faculty, lab in-charges and admins.
      </EmptyState>
    );
  }
  return <Inbox meId={me.data.id} />;
}

function Inbox({ meId }: { meId: string }) {
  const [onlyMine, setOnlyMine] = useState(true);
  const inbox = useInbox(onlyMine);
  const actions = useApprovalActions(meId);
  const now = useNow(30_000);
  const count = inbox.data?.length;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Approvals"
        description={
          count === undefined
            ? "Booking requests waiting for a decision, soonest first."
            : count === 0
              ? "Nothing is waiting right now."
              : `${count} request${count === 1 ? "" : "s"} waiting, soonest first. Approve to confirm the time; reject with a reason the booker will see.`
        }
        actions={
          <Checkbox label="Also show pending bookings I can't decide" checked={!onlyMine} onChange={(e) => setOnlyMine(!e.target.checked)} />
        }
      />

      {/* The one status region on this page: each decision's result. */}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "text-body",
          actions.notice &&
            (actions.notice.tone === "error"
              ? "mb-4 rounded-control border border-st-cancelled-border bg-st-cancelled-bg px-3 py-2 text-st-cancelled-fg"
              : "mb-4 rounded-control border border-st-checked-in-border bg-st-checked-in-bg px-3 py-2 text-st-checked-in-fg"),
        )}
      >
        {actions.notice?.text}
      </p>

      {inbox.isError ? (
        <p role="alert" className="text-body text-danger-text">
          {describeApiError(inbox.error)}
        </p>
      ) : inbox.isPending ? (
        <div aria-label="Loading the inbox" className="flex flex-col divide-y divide-line border-y border-line">
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid gap-2 py-4 lg:grid-cols-[10rem_minmax(0,1fr)_14rem]">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-64 max-w-full" />
              <Skeleton className="h-9 w-40 max-lg:hidden" />
            </div>
          ))}
        </div>
      ) : inbox.data.length === 0 ? (
        <EmptyState icon={Check} title={onlyMine ? "Nothing waiting for your decision." : "No pending bookings on your resources."}>
          New requests on the resources you approve appear here as they come in.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line" aria-label="Pending bookings">
          {inbox.data.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              meId={meId}
              now={now}
              busy={actions.busyId === item.id}
              onDecide={(action, comment) => actions.act(item, action, comment)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One request in the queue: when (left), who and what and why (middle), the
 * decision (right). On a phone the same parts stack, with the actions last.
 */
function InboxRow({
  item,
  meId,
  now,
  busy,
  onDecide,
}: {
  item: InboxItem;
  meId: string;
  now: Date;
  busy: boolean;
  onDecide: (action: "approve" | "reject", comment?: string) => Promise<boolean>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const allowed = availableActions(item, now);
  const lapsedNow = allowed.reject && !allowed.approve;
  const blocked = whyNotDecidable(item, meId);
  const headingId = `inbox-${item.id}`;
  const start = new Date(item.start);
  const end = new Date(item.end);

  const submitReject = async () => {
    const problem = rejectionCommentError(comment);
    setCommentError(problem);
    if (problem) return;
    await onDecide("reject", comment);
  };

  return (
    <li className="grid gap-x-6 gap-y-3 py-4 lg:grid-cols-[10rem_minmax(0,1fr)_minmax(14rem,auto)] lg:items-start" aria-labelledby={headingId}>
      {/* When: drawn as date over time; read once, as one phrase. */}
      <div className="flex items-baseline gap-2 lg:flex-col lg:gap-0.5">
        <span aria-hidden="true" className="text-body font-medium text-ink">
          {formatDate(start)}
        </span>
        <span aria-hidden="true" className="font-condensed text-lead font-medium text-ink tabular-nums lg:text-h3">
          {formatTime(start)}–{formatTime(end)}
        </span>
        <span className="sr-only">{formatPeriod(start, end)}</span>
      </div>

      {/* Who, what, why. */}
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 id={headingId} className="text-lead font-semibold text-ink">
            {item.resource.name}
          </h2>
          {item.stalled && (
            <Badge tone="pending" icon={Clock3}>
              Stalled: level 2 silent 24 h+
            </Badge>
          )}
          {(item.lapsed || lapsedNow) && <Badge icon={TimerOff}>Start time passed</Badge>}
        </div>
        <p className="text-body text-ink-muted">
          <span className="font-medium text-ink">{item.booker.fullName}</span>
          {", "}
          <span className="tabular-nums">
            {item.attendeeCount} {item.attendeeCount === 1 ? "person" : "people"} · awaiting level {item.awaitingLevel ?? "?"}
          </span>
        </p>
        <p className="text-body text-ink">{item.purpose || <span className="text-ink-faint">No purpose given</span>}</p>
        {item.approvals.length > 0 && (
          <ol className="mt-1 flex flex-col gap-0.5 border-l-2 border-line pl-3 text-small text-ink-muted" aria-label="Approval trail">
            {item.approvals.map((a) => (
              <li key={`${a.level}-${a.approverId}`}>
                Level {a.level} {a.decision} by {a.approverName}, {formatDateTime(new Date(a.decidedAt))}
                {a.comment && <>: “{a.comment}”</>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* The decision. */}
      <div className="flex flex-col gap-2 lg:items-end">
        {blocked ? (
          <p className="text-small text-ink-muted lg:max-w-60 lg:text-right">{blocked}</p>
        ) : rejecting ? (
          <div className="flex w-full flex-col gap-2 lg:w-80">
            <Field label="Reason for rejecting (the booker sees this)" error={commentError} errorId={`${headingId}-err`}>
              {(control) => (
                <Textarea {...control} autoFocus rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
              )}
            </Field>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button variant="danger" disabled={busy} onClick={() => void submitReject()}>
                {busy ? "Rejecting…" : "Reject booking"}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {allowed.approve && (
              <Button variant="primary" disabled={busy} onClick={() => void onDecide("approve")} className="max-lg:flex-1">
                {busy ? "Approving…" : "Approve"}
              </Button>
            )}
            {allowed.reject && (
              <Button disabled={busy} onClick={() => setRejecting(true)} className="max-lg:flex-1">
                Reject…
              </Button>
            )}
          </div>
        )}
        {lapsedNow && !rejecting && <p className="text-small text-ink-muted lg:text-right">Its start has passed, so it can only be rejected.</p>}
      </div>
    </li>
  );
}
