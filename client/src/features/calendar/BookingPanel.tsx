import { forwardRef, useState, type FormEvent } from "react";
import { formatDuration } from "../../lib/api-errors";
import type { Resource } from "../resources/use-resources";
import { formatPeriod, formatTime } from "./format";
import type { Interval } from "./grid";
import type { Draft, PanelOutcome } from "./use-calendar";

interface BookingPanelProps {
  resource: Resource;
  selection: Interval;
  /** Ends the selection may have (grid.endOptions), shortest first. */
  endOptions: readonly Date[];
  initialEnd: Date | null;
  outcome: PanelOutcome;
  onBook: (draft: Draft) => void;
  onJoinWaitlist: (draft: Draft) => void;
  onClose: () => void;
}

const control =
  "min-h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60";
const button =
  "min-h-9 rounded-md px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50";

/** The waitlist is offered once someone else has taken the time. */
const offerWaitlist = (outcome: PanelOutcome) =>
  (outcome.kind === "failed" && outcome.conflict) || outcome.kind === "joiningWaitlist" || outcome.kind === "waitlistFailed";

/**
 * The side panel for a selection: length, purpose and attendees, then
 * submit. Remounted for each new selection (keyed by the caller), so its
 * fields start fresh. After a conflict it stays open with the sentence and
 * offers the waitlist for the same time.
 */
export const BookingPanel = forwardRef<HTMLSelectElement, BookingPanelProps>(function BookingPanel(
  { resource, selection, endOptions, initialEnd, outcome, onBook, onJoinWaitlist, onClose },
  endRef,
) {
  const [end, setEnd] = useState<number | null>(initialEnd?.getTime() ?? null);
  const [purpose, setPurpose] = useState("");
  const [attendees, setAttendees] = useState(1);

  const busy = outcome.kind === "submitting" || outcome.kind === "joiningWaitlist";
  const done = outcome.kind === "booked" || outcome.kind === "waitlisted";
  // After a conflict the chosen time may no longer be free; keep showing it.
  const stillFree = end !== null && endOptions.some((o) => o.getTime() === end);
  const choices = end !== null && !stillFree ? [new Date(end), ...endOptions] : endOptions;
  const draft: Draft | null =
    end === null ? null : { start: selection.start, end: new Date(end), purpose, attendeeCount: attendees };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft && stillFree) onBook(draft);
  };

  return (
    <form onSubmit={submit} aria-label="New booking" className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">
          {draft ? formatPeriod(draft.start, draft.end) : formatPeriod(selection.start, selection.end)}
        </h2>
        <button type="button" onClick={onClose} className={`${button} -mt-1 -mr-1 min-h-7 px-2 text-slate-400 hover:text-white`} aria-label="Close">
          ✕
        </button>
      </div>

      {end === null ? (
        <p className="text-sm text-amber-200">
          There isn't room here for {resource.name}'s shortest booking ({formatDuration(resource.minSlotMinutes)}); pick another time.
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Ends at
            <select
              ref={endRef}
              className={control}
              value={end}
              disabled={busy || done}
              onChange={(e) => setEnd(Number(e.target.value))}
            >
              {choices.map((option) => (
                <option key={option.getTime()} value={option.getTime()}>
                  {formatTime(option)} ({formatDuration(Math.round((option.getTime() - selection.start.getTime()) / 60_000))})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Purpose
            <input
              className={control}
              maxLength={500}
              placeholder="e.g. Physics practical, batch B"
              value={purpose}
              disabled={busy || done}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            <span>
              Attendees{resource.capacity > 0 && <span className="text-slate-500"> (up to {resource.capacity})</span>}
            </span>
            <input
              className={control}
              type="number"
              inputMode="numeric"
              min={1}
              max={resource.capacity > 0 ? resource.capacity : undefined}
              required
              value={attendees}
              disabled={busy || done}
              onChange={(e) => setAttendees(Number(e.target.value))}
            />
          </label>
        </>
      )}

      {end !== null && !stillFree && outcome.kind === "idle" && (
        <p className="text-sm text-amber-200">That time is no longer free; pick another.</p>
      )}
      {outcome.kind === "failed" && <p className="rounded-md bg-rose-500/15 p-2 text-sm text-rose-200">{outcome.message}</p>}
      {outcome.kind === "waitlistFailed" && <p className="rounded-md bg-rose-500/15 p-2 text-sm text-rose-200">{outcome.message}</p>}
      {outcome.kind === "booked" && (
        <p className="rounded-md bg-emerald-500/15 p-2 text-sm text-emerald-200">
          {outcome.booking.status === "pending" ? "Booked; waiting for approval." : "Booked and approved."}
        </p>
      )}
      {outcome.kind === "waitlisted" && (
        <p className="rounded-md bg-emerald-500/15 p-2 text-sm text-emerald-200">
          You're on the waitlist. If this time frees up it is booked for you automatically
          {resource.requiresApproval ? ", then needs approval" : ""}.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {done ? (
          <button type="button" onClick={onClose} className={`${button} border border-slate-600 text-slate-200`}>
            Done
          </button>
        ) : (
          <>
            {draft && stillFree && (
              <button type="submit" disabled={busy} className={`${button} bg-indigo-600 text-white`}>
                {outcome.kind === "submitting" ? "Booking…" : outcome.kind === "failed" ? "Try again" : "Book"}
              </button>
            )}
            {draft && offerWaitlist(outcome) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onJoinWaitlist(draft)}
                  className={`${button} border border-indigo-400 text-indigo-200`}
                >
                  {outcome.kind === "joiningWaitlist" ? "Joining…" : "Join the waitlist"}
                </button>
              )}
          </>
        )}
      </div>
      {resource.requiresApproval && !done && <p className="text-xs text-slate-500">Bookings here need approval.</p>}
    </form>
  );
});
