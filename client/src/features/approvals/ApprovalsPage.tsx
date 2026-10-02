import { useState } from "react";
import { describeApiError } from "../../lib/api-errors";
import { useNow } from "../../lib/use-now";
import { isStaff, useMe } from "../auth/use-me";
import { formatDateTime, formatPeriod } from "../calendar/format";
import { availableActions, rejectionCommentError, whyNotDecidable, type InboxItem } from "./model";
import { useApprovalActions, useInbox } from "./use-approvals";

const button =
  "min-h-8 rounded-md px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50";

/** §11 approvals inbox: approve or reject in place, oldest start first. */
export default function ApprovalsPage() {
  const me = useMe();
  // Wait for the role, so the inbox is only asked for by staff.
  if (!me.data) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!isStaff(me.data)) {
    return <p className="text-sm text-slate-300">The approvals inbox is for faculty, lab in-charges and admins.</p>;
  }
  return <Inbox meId={me.data.id} />;
}

function Inbox({ meId }: { meId: string }) {
  const [onlyMine, setOnlyMine] = useState(true);
  const inbox = useInbox(onlyMine);
  const actions = useApprovalActions(meId);
  const now = useNow(30_000);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-bold text-white">
          Approvals{inbox.data && <span className="ml-2 text-sm font-normal text-slate-400">{inbox.data.length}</span>}
        </h1>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={!onlyMine}
            onChange={(e) => setOnlyMine(!e.target.checked)}
            className="size-4 accent-indigo-500"
          />
          Also show pending bookings I can't decide
        </label>
      </div>

      <p
        role="status"
        aria-live="polite"
        className={`min-h-5 text-sm ${actions.notice?.tone === "error" ? "rounded-md bg-rose-600/20 p-2 text-rose-200" : actions.notice ? "rounded-md bg-emerald-600/15 p-2 text-emerald-200" : ""}`}
      >
        {actions.notice?.text}
      </p>

      {inbox.isError ? (
        <p role="alert" className="rounded-md bg-rose-600/20 p-2 text-sm text-rose-200">
          {describeApiError(inbox.error)}
        </p>
      ) : inbox.isPending ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : inbox.data.length === 0 ? (
        <p className="text-sm text-slate-400">{onlyMine ? "Nothing waiting for your decision." : "No pending bookings on your resources."}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-800 rounded-lg border border-slate-800" aria-label="Pending bookings">
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

  const submitReject = async () => {
    const problem = rejectionCommentError(comment);
    setCommentError(problem);
    if (problem) return;
    await onDecide("reject", comment);
  };

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-start sm:justify-between" aria-labelledby={headingId}>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 id={headingId} className="font-semibold text-white">
            {item.resource.name}
          </h2>
          <span className="tabular-nums text-slate-200">{formatPeriod(new Date(item.start), new Date(item.end))}</span>
          {item.stalled && (
            <span className="rounded border border-amber-400/60 px-1.5 text-[11px] font-semibold text-amber-200">
              Stalled: level 2 silent 24 h+
            </span>
          )}
          {(item.lapsed || lapsedNow) && (
            <span className="rounded bg-rose-500/20 px-1.5 text-[11px] font-semibold text-rose-200">Start time passed</span>
          )}
        </div>
        <p className="text-slate-300">
          <span className="font-medium text-slate-100">{item.booker.fullName}</span> · {item.attendeeCount}{" "}
          {item.attendeeCount === 1 ? "person" : "people"} · awaiting level {item.awaitingLevel ?? "?"}
        </p>
        <p className="text-slate-300">{item.purpose || <span className="text-slate-500">No purpose given</span>}</p>
        {item.approvals.length > 0 && (
          <ol className="mt-0.5 text-xs text-slate-400" aria-label="Approval trail">
            {item.approvals.map((a) => (
              <li key={`${a.level}-${a.approverId}`}>
                Level {a.level} {a.decision} by {a.approverName}, {formatDateTime(new Date(a.decidedAt))}
                {a.comment && <>: “{a.comment}”</>}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
        {blocked ? (
          <p className="text-xs text-slate-400">{blocked}</p>
        ) : rejecting ? (
          <div className="flex w-full flex-col gap-1.5 sm:w-72">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Reason for rejecting (the booker sees this)
              <textarea
                autoFocus
                rows={2}
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                aria-invalid={commentError !== null}
                aria-describedby={commentError ? `${headingId}-err` : undefined}
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              />
            </label>
            {commentError && (
              <p id={`${headingId}-err`} className="text-xs text-rose-300">
                {commentError}
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void submitReject()} className={`${button} bg-rose-600 text-white`}>
                {busy ? "Rejecting…" : "Reject booking"}
              </button>
              <button type="button" disabled={busy} onClick={() => setRejecting(false)} className={`${button} text-slate-300`}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {allowed.approve && (
              <button type="button" disabled={busy} onClick={() => void onDecide("approve")} className={`${button} bg-emerald-600 text-white`}>
                {busy ? "Approving…" : "Approve"}
              </button>
            )}
            {allowed.reject && (
              <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={`${button} border border-rose-400/70 text-rose-200`}>
                Reject…
              </button>
            )}
          </div>
        )}
        {lapsedNow && !rejecting && <p className="text-xs text-slate-400">Its start has passed, so it can only be rejected.</p>}
      </div>
    </li>
  );
}
