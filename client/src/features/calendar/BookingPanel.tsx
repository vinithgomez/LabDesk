import { CircleAlert, CircleCheck, X } from "lucide-react";
import { forwardRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Checkbox, cn, Field, ICON_STROKE, IconButton, Input, Select } from "../../components/ui";
import { formatDuration } from "../../lib/api-errors";
import type { Resource } from "../resources/use-resources";
import { defaultRepeat, validateRepeat, type Repeat } from "../series/rrule";
import { WEEKDAYS, formatPeriod, formatTime } from "./format";
import { istDayKey, type Interval } from "./grid";
import { seriesSummary, type Draft, type PanelOutcome } from "./use-calendar";

interface BookingPanelProps {
  resource: Resource;
  selection: Interval;
  /** Ends the selection may have (grid.endOptions), shortest first. */
  endOptions: readonly Date[];
  initialEnd: Date | null;
  outcome: PanelOutcome;
  onBook: (draft: Draft) => void;
  onJoinWaitlist: (draft: Draft) => void;
  /** Book the slot every chosen weekday until a date (a series). */
  onBookSeries: (draft: Draft, repeat: Repeat) => void;
  onClose: () => void;
  /** Draw its own border (beside the calendar); a drawer or sheet already frames it. */
  framed?: boolean;
  /** The phone sheet: tighter spacing and a smaller heading, so the chosen time stays in view above it. */
  compact?: boolean;
}

/** The waitlist is offered once someone else has taken the time. */
const offerWaitlist = (outcome: PanelOutcome) =>
  (outcome.kind === "failed" && outcome.conflict) || outcome.kind === "joiningWaitlist" || outcome.kind === "waitlistFailed";

/**
 * The booking panel for a selection: length, purpose and attendees, then
 * submit. Remounted for each new selection (keyed by the caller), so its
 * fields start fresh. After a conflict it stays open with the sentence and
 * offers the waitlist for the same time. Error sentences come only from
 * lib/api-errors.ts (through the outcome).
 */
export const BookingPanel = forwardRef<HTMLSelectElement, BookingPanelProps>(function BookingPanel(
  { resource, selection, endOptions, initialEnd, outcome, onBook, onJoinWaitlist, onBookSeries, onClose, framed = true, compact = false },
  endRef,
) {
  const [end, setEnd] = useState<number | null>(initialEnd?.getTime() ?? null);
  const [purpose, setPurpose] = useState("");
  const [attendees, setAttendees] = useState(1);
  const [repeating, setRepeating] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>(() => defaultRepeat(selection.start));
  const [repeatError, setRepeatError] = useState<string | null>(null);

  const busy = outcome.kind === "submitting" || outcome.kind === "joiningWaitlist" || outcome.kind === "creatingSeries";
  const done = outcome.kind === "booked" || outcome.kind === "waitlisted" || outcome.kind === "seriesCreated";
  const toggleDay = (day: number) =>
    setRepeat((r) => ({ ...r, days: r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day] }));
  // After a conflict the chosen time may no longer be free; keep showing it.
  const stillFree = end !== null && endOptions.some((o) => o.getTime() === end);
  const choices = end !== null && !stillFree ? [new Date(end), ...endOptions] : endOptions;
  const draft: Draft | null =
    end === null ? null : { start: selection.start, end: new Date(end), purpose, attendeeCount: attendees };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !stillFree || busy) return;
    if (!repeating) {
      onBook(draft);
      return;
    }
    const problem = validateRepeat(repeat, draft.start);
    setRepeatError(problem);
    if (!problem) onBookSeries(draft, repeat);
  };

  return (
    <form
      onSubmit={submit}
      aria-label="New booking"
      className={cn(
        "flex flex-col",
        compact ? "gap-3 px-4 pt-2 pb-4" : "gap-4 p-4 md:p-5",
        framed && "rounded-panel border border-line bg-surface",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-small text-ink-muted">New booking</p>
          <h2 className={cn("font-semibold text-ink tabular-nums", compact ? "text-lead" : "text-h3")}>
            {draft ? formatPeriod(draft.start, draft.end) : formatPeriod(selection.start, selection.end)}
          </h2>
        </div>
        <IconButton icon={X} label="Close" onClick={onClose} className="-mt-1 -mr-2" />
      </div>

      {!done && (
        <p className={cn("text-ink-muted", compact ? "text-small" : "text-body")}>
          {resource.requiresApproval
            ? "Bookings here need approval: yours shows as Pending until an owner approves it."
            : "No approval needed: the time is yours as soon as you book."}
        </p>
      )}

      {end === null ? (
        <Note tone="warning">
          There isn&apos;t room here for {resource.name}&apos;s shortest booking ({formatDuration(resource.minSlotMinutes)}); pick another
          time.
        </Note>
      ) : (
        <>
          <Field label="Ends at">
            {(control) => (
              <Select
                {...control}
                ref={endRef}
                data-autofocus
                className="tabular-nums"
                value={end}
                disabled={busy || done}
                onChange={(e) => setEnd(Number(e.target.value))}
              >
                {choices.map((option) => (
                  <option key={option.getTime()} value={option.getTime()}>
                    {formatTime(option)} ({formatDuration(Math.round((option.getTime() - selection.start.getTime()) / 60_000))})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Purpose">
            {(control) => (
              <Input
                {...control}
                maxLength={500}
                placeholder="e.g. Physics practical, batch B"
                value={purpose}
                disabled={busy || done}
                onChange={(e) => setPurpose(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Attendees"
            helper={
              resource.capacity > 0
                ? `${resource.name} holds up to ${resource.capacity} ${resource.capacity === 1 ? "person" : "people"}.`
                : "There is no limit on the number of people."
            }
          >
            {(control) => (
              <Input
                {...control}
                className="tabular-nums"
                type="number"
                inputMode="numeric"
                min={1}
                max={resource.capacity > 0 ? resource.capacity : undefined}
                required
                value={attendees}
                disabled={busy || done}
                onChange={(e) => setAttendees(Number(e.target.value))}
              />
            )}
          </Field>
          <Checkbox label="Repeat weekly" checked={repeating} disabled={busy || done} onChange={(e) => setRepeating(e.target.checked)} />
          {repeating && (
            <fieldset
              className="-mt-2 flex flex-col gap-3 rounded-control border border-line bg-sunken/50 p-3"
              disabled={busy || done}
              aria-describedby="repeat-hint"
            >
              <legend className="px-1 text-small font-medium text-ink">Repeat on</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {WEEKDAYS.map((d) => (
                  <label key={d.value} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-body text-ink md:min-h-8">
                    <input
                      type="checkbox"
                      className="size-4 accent-cobalt"
                      checked={repeat.days.includes(d.value)}
                      onChange={() => toggleDay(d.value)}
                    />
                    <abbr title={d.long} className="no-underline">
                      {d.short}
                    </abbr>
                  </label>
                ))}
              </div>
              <Field label="Repeat weekly until">
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    min={istDayKey(selection.start)}
                    value={repeat.until}
                    onChange={(e) => setRepeat((r) => ({ ...r, until: e.target.value }))}
                  />
                )}
              </Field>
              <p id="repeat-hint" className="text-small text-ink-muted">
                Same time each chosen day, from the next one that&apos;s still ahead. Each date is booked separately; dates that are
                taken are skipped.
              </p>
              {repeatError && <Note tone="error">{repeatError}</Note>}
            </fieldset>
          )}
        </>
      )}

      {end !== null && !stillFree && outcome.kind === "idle" && <Note tone="warning">That time is no longer free; pick another.</Note>}
      {outcome.kind === "failed" && <Note tone="error">{outcome.message}</Note>}
      {outcome.kind === "waitlistFailed" && <Note tone="error">{outcome.message}</Note>}
      {outcome.kind === "seriesFailed" && <Note tone="error">{outcome.message}</Note>}
      {outcome.kind === "seriesCreated" && (
        <Note tone="success">
          {seriesSummary(outcome.series)}{" "}
          <Link to={`/series/${outcome.series.id}`} className="font-medium text-cobalt underline underline-offset-4">
            View the series
          </Link>
        </Note>
      )}
      {outcome.kind === "booked" && (
        <Note tone="success">{outcome.booking.status === "pending" ? "Booked; waiting for approval." : "Booked and approved."}</Note>
      )}
      {outcome.kind === "waitlisted" && (
        <Note tone="success">
          You&apos;re on the waitlist. If this time frees up it is booked for you automatically
          {resource.requiresApproval ? ", then needs approval" : ""}.
        </Note>
      )}

      <div className="flex flex-wrap gap-2">
        {done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            {draft && stillFree && (
              <Button type="submit" variant="primary" disabled={busy} className="max-md:flex-1">
                {outcome.kind === "submitting" || outcome.kind === "creatingSeries"
                  ? "Booking…"
                  : outcome.kind === "failed" || outcome.kind === "seriesFailed"
                    ? "Try again"
                    : repeating
                      ? "Book every week"
                      : "Book"}
              </Button>
            )}
            {draft && offerWaitlist(outcome) && (
              <Button disabled={busy} onClick={() => onJoinWaitlist(draft)} className="max-md:flex-1">
                {outcome.kind === "joiningWaitlist" ? "Joining…" : "Join the waitlist"}
              </Button>
            )}
          </>
        )}
      </div>
    </form>
  );
});

/** A one-sentence result or warning inside the panel. The page's status region announces results; this shows them. */
function Note({ tone, children }: { tone: "success" | "warning" | "error"; children: ReactNode }) {
  const Icon = tone === "success" ? CircleCheck : CircleAlert;
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-control border px-3 py-2 text-body",
        tone === "success" && "border-st-checked-in-border bg-st-checked-in-bg text-st-checked-in-fg",
        tone === "warning" && "border-st-pending-border bg-st-pending-bg text-st-pending-fg",
        tone === "error" && "border-st-cancelled-border bg-st-cancelled-bg text-st-cancelled-fg",
      )}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
