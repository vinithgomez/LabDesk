import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, cn, Drawer, ICON_STROKE, IconButton } from "../../components/ui";
import { describeApiError, formatDuration } from "../../lib/api-errors";
import { PHONE_QUERY, useMediaQuery, WIDE_QUERY } from "../../lib/use-media-query";
import { useNow } from "../../lib/use-now";
import { useResource, type Resource } from "../resources/use-resources";
import { BookingPanel } from "./BookingPanel";
import { formatDayLong, formatDayOfMonth, formatTime, formatWeek, formatWeekday } from "./format";
import { addDays, istDayKey, istWeekStart, selectionFromSpan, slotStart, type DayKey } from "./grid";
import { IDLE, tapSlot, type TapState } from "./tap-select";
import { useBookingPanel } from "./use-calendar";
import { panelChoices, useWeekView, type ChosenSlot } from "./use-week-view";
import { WeekGrid, type GridSelection, type SelectVia } from "./WeekGrid";

const TYPE_LABEL: Record<Resource["type"], string> = { lab: "Lab", room: "Room", equipment: "Equipment" };

/** §11 week calendar for one resource: /resources/:id */
export default function CalendarPage() {
  const { id } = useParams();
  const resource = useResource(id);
  if (resource.isPending) {
    return (
      <p role="status" className="text-body text-ink-muted">
        Loading…
      </p>
    );
  }
  if (resource.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-body text-danger-text">
          {describeApiError(resource.error)}
        </p>
        <BackLink />
      </div>
    );
  }
  return <ResourceCalendar key={resource.data.id} resource={resource.data} />;
}

function BackLink() {
  return (
    <Link to="/resources" className="inline-flex items-center gap-1.5 text-small text-ink-muted underline-offset-4 hover:text-ink hover:underline">
      <ArrowLeft aria-hidden="true" size={14} strokeWidth={ICON_STROKE} />
      All resources
    </Link>
  );
}

/** One plain line about the resource: what and where, how long, how far ahead. */
function describeResource(r: Resource): string {
  const who = r.capacity > 0 ? `, for up to ${r.capacity} ${r.capacity === 1 ? "person" : "people"}` : "";
  return `${TYPE_LABEL[r.type]} in ${r.location}${who}. Book ${formatDuration(r.minSlotMinutes)} to ${formatDuration(r.maxSlotMinutes)} at a time, up to ${r.bookingHorizonDays} days ahead.`;
}

function ResourceCalendar({ resource }: { resource: Resource }) {
  const now = useNow(30_000);
  const phone = useMediaQuery(PHONE_QUERY, false);
  // Wide enough for the panel to sit beside the week (1280px and up); jsdom answers yes.
  const wide = useMediaQuery(WIDE_QUERY, true);
  const [weekStart, setWeekStart] = useState(() => istWeekStart(new Date()));
  const view = useWeekView(resource, weekStart, now);
  const panel = useBookingPanel(resource, weekStart);
  const [chosen, setChosen] = useState<ChosenSlot | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLSelectElement>(null);
  const selectedVia = useRef<SelectVia | null>(null);
  const today = istDayKey(now);
  // Phones show one day at a time: today when it is in the shown week, else the week's Monday.
  const [dayIndex, setDayIndex] = useState(() => Math.max(0, view.days.indexOf(today)));
  const [tap, setTap] = useState<TapState>(IDLE);
  const settleId = panel.outcome.kind === "booked" ? panel.outcome.booking.id : null;

  // Once a new selection's panel is mounted beside the week: scroll to it after a tap, focus it otherwise.
  // (In a drawer or sheet, the drawer moves focus itself.) On a phone, scroll the page so the chosen
  // time sits just above the sheet, where it stays in sight while the booking is filled in.
  useEffect(() => {
    if (phone && chosen) keepAboveSheet(chosen.span);
    else if (selectedVia.current === "tap") panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    else if (selectedVia.current) endRef.current?.focus();
    selectedVia.current = null;
    // Only for a new selection (panelKey), not whenever the page re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelKey]);

  const choices = chosen ? panelChoices(view, chosen, resource, now) : null;

  const changeWeek = (next: DayKey) => {
    setWeekStart(next);
    setChosen(null);
    setTap(IDLE);
    setDayIndex(next === istWeekStart(new Date()) ? Math.max(0, (Date.parse(today) - Date.parse(next)) / 86_400_000) : 0);
    panel.reset();
  };

  const select = (selection: GridSelection, via: SelectVia) => {
    const day = view.days[selection.day];
    const interval = day === undefined ? null : selectionFromSpan(day, view.range, selection.span, new Date());
    if (!interval) return;
    setChosen({ ...selection, interval });
    setTap(IDLE);
    selectedVia.current = via;
    setPanelKey((k) => k + 1);
    panel.reset();
  };

  const close = () => {
    setChosen(null);
    panel.reset();
  };

  const bookingPanel = (framed: boolean, compact = false) =>
    chosen && choices ? (
      <BookingPanel
        key={panelKey}
        ref={endRef}
        resource={resource}
        selection={chosen.interval}
        endOptions={choices.options}
        initialEnd={choices.initialEnd}
        outcome={panel.outcome}
        onBook={(draft) => void panel.book(draft)}
        onJoinWaitlist={(draft) => void panel.joinWaitlist(draft)}
        onBookSeries={(draft, repeat) => void panel.bookSeries(draft, repeat)}
        onClose={close}
        framed={framed}
        compact={compact}
      />
    ) : null;

  const weekLabel = formatWeek(view.days[0] ?? weekStart, view.days[6] ?? weekStart);
  const weekNav = (
    <div className="flex items-center gap-1">
      <IconButton icon={ChevronLeft} label="Previous week" onClick={() => changeWeek(addDays(weekStart, -7))} />
      <Button onClick={() => changeWeek(istWeekStart(new Date()))}>Today</Button>
      <IconButton icon={ChevronRight} label="Next week" onClick={() => changeWeek(addDays(weekStart, 7))} />
      <span className="ml-2 text-body font-medium whitespace-nowrap text-ink tabular-nums" aria-live="polite">
        {weekLabel}
      </span>
    </div>
  );

  const grid = (
    <div className={cn("min-w-0 transition-opacity duration-150", view.loading && "opacity-60")} aria-busy={view.loading}>
      {phone ? (
        <WeekGrid
          mode="day"
          rowPx={44}
          days={[view.days[dayIndex] ?? weekStart]}
          today={today}
          now={now}
          range={view.range}
          events={view.events}
          blocked={[view.blocked[dayIndex] ?? []]}
          past={[view.past[dayIndex] ?? []]}
          open={[view.open[dayIndex] ?? []]}
          selection={panel.outcome.kind === "booked" || chosen?.day !== dayIndex ? null : chosen.interval}
          selectionDay={chosen?.day === dayIndex ? 0 : null}
          onSelect={(selection, via) => select({ ...selection, day: dayIndex }, via)}
          onTap={(_day, slot) => {
            const result = tapSlot(tap, slot, view.blocked[dayIndex] ?? []);
            setTap(result.state);
            if (result.span) select({ day: dayIndex, span: result.span }, "tap");
          }}
          pendingStart={tap.kind === "start" ? { day: 0, slot: tap.slot } : null}
          settleId={settleId}
        />
      ) : (
        <WeekGrid
          days={view.days}
          today={today}
          now={now}
          range={view.range}
          events={view.events}
          blocked={view.blocked}
          past={view.past}
          open={view.open}
          selection={panel.outcome.kind === "booked" ? null : (chosen?.interval ?? null)}
          selectionDay={chosen?.day ?? null}
          onSelect={select}
          settleId={settleId}
        />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <BackLink />
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-h2 font-semibold text-ink md:text-h1">{resource.name}</h1>
            <p className="mt-1 max-w-[72ch] text-body text-ink-muted">{describeResource(resource)}</p>
          </div>
          {!phone && weekNav}
        </div>
        <Legend />
      </header>

      {view.error !== null && (
        <p role="alert" className="rounded-control border border-st-cancelled-border bg-st-cancelled-bg px-3 py-2 text-body text-st-cancelled-fg">
          {describeApiError(view.error)}
        </p>
      )}

      {phone ? (
        <>
          <DayStrip
            days={view.days}
            today={today}
            selected={dayIndex}
            onSelect={(i) => {
              setDayIndex(i);
              setTap(IDLE);
            }}
            weekLabel={weekLabel}
            onPrevious={() => changeWeek(addDays(weekStart, -7))}
            onNext={() => changeWeek(addDays(weekStart, 7))}
          />
          <p className="text-body text-ink-muted" aria-live="polite">
            {tap.kind === "start" ? (
              <>
                From <span className="font-medium text-ink tabular-nums">{formatTime(slotStart(view.days[dayIndex] ?? weekStart, view.range, tap.slot))}</span>.
                Tap the last half hour you need, or the same one again to clear it.
              </>
            ) : (
              "Tap where your booking starts, then where it ends."
            )}
          </p>
          {grid}
          {/* Room below the grid, so the page can scroll the chosen time up above the open sheet. */}
          {chosen && <div aria-hidden="true" className="h-[60dvh]" />}
          <Drawer open={chosen !== null} onClose={close} label="New booking" side="bottom">
            {bookingPanel(false, true)}
          </Drawer>
        </>
      ) : wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_22rem] items-start gap-6">
          {grid}
          <div ref={panelRef} className="sticky top-6">
            {bookingPanel(true) ?? <PanelHint resource={resource} />}
          </div>
        </div>
      ) : (
        <>
          <p className="text-body text-ink-muted">Drag down a day to choose a time, or use the arrow keys and Enter.</p>
          {grid}
          {/* The drawer opens on the side away from the chosen day, so it never covers the time you picked. */}
          <Drawer open={chosen !== null} onClose={close} label="New booking" side={(chosen?.day ?? 0) >= 3 ? "left" : "right"}>
            {bookingPanel(false)}
          </Drawer>
        </>
      )}

      <p aria-live="polite" role="status" className="sr-only">
        {panel.announcement}
      </p>
    </div>
  );
}

/**
 * Phones: scrolls the page so the chosen rows (`span`, in the one-day grid)
 * end just above the booking sheet, or start just below the top bar if the
 * range is too tall for the gap.
 */
function keepAboveSheet(span: { first: number; last: number }): void {
  const first = document.querySelector<HTMLElement>(`[role=gridcell][data-day-index="0"][data-slot="${span.first}"]`);
  const last = document.querySelector<HTMLElement>(`[role=gridcell][data-day-index="0"][data-slot="${span.last}"]`);
  const sheet = document.querySelector<HTMLElement>('[role=dialog][aria-label="New booking"]');
  if (!first || !last || !sheet) return;
  const topBar = 56 + 8;
  const room = sheet.getBoundingClientRect().top - 12;
  const top = first.getBoundingClientRect().top;
  const bottom = last.getBoundingClientRect().bottom;
  const delta = bottom - top <= room - topBar ? bottom - room : top - topBar;
  if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: "smooth" });
}

/** Beside the week before anything is chosen: how to choose, and this resource's rules in plain sentences. */
function PanelHint({ resource }: { resource: Resource }) {
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-5">
      <h2 className="text-lead font-semibold text-ink">Choose a time</h2>
      <p className="text-body text-ink-muted">
        Drag down a day to choose a time, or use the arrow keys and Enter. On a touch screen, tap a half hour.
      </p>
      <ul className="flex flex-col gap-2 border-t border-line pt-3 text-body text-ink">
        <li>
          {resource.requiresApproval
            ? "Bookings need approval from an owner; until then they show as Pending."
            : "No approval needed: a booking is confirmed straight away."}
        </li>
        <li>
          Each booking lasts {formatDuration(resource.minSlotMinutes)} to {formatDuration(resource.maxSlotMinutes)}.
        </li>
        <li>
          {resource.capacity > 0
            ? `Up to ${resource.capacity} ${resource.capacity === 1 ? "person" : "people"} at a time.`
            : "No limit on the number of people."}
        </li>
        <li>You can book up to {resource.bookingHorizonDays} days ahead.</li>
      </ul>
    </div>
  );
}

/** Phones: the week as a strip of seven days (today marked), arrows to change week. */
function DayStrip({
  days,
  today,
  selected,
  onSelect,
  weekLabel,
  onPrevious,
  onNext,
}: {
  days: readonly DayKey[];
  today: DayKey;
  selected: number;
  onSelect: (index: number) => void;
  weekLabel: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <IconButton icon={ChevronLeft} label="Previous week" onClick={onPrevious} />
        <span className="text-body font-medium text-ink tabular-nums" aria-live="polite">
          {weekLabel}
        </span>
        <IconButton icon={ChevronRight} label="Next week" onClick={onNext} />
      </div>
      <ul className="grid grid-cols-7 gap-1" aria-label="Days of the week">
        {days.map((day, i) => {
          const isToday = day === today;
          const isSelected = i === selected;
          return (
            <li key={day}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={`${formatDayLong(day)}${isToday ? ", today" : ""}`}
                onClick={() => onSelect(i)}
                className={cn(
                  "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-control border transition-colors duration-150 ease-out",
                  isSelected ? "border-primary bg-primary text-on-cobalt" : "border-line bg-surface text-ink hover:bg-sunken",
                )}
              >
                <span className={cn("text-meta", !isSelected && (isToday ? "font-medium text-cobalt" : "text-ink-muted"))}>
                  {formatWeekday(day)}
                </span>
                <span className="font-condensed text-lead leading-none font-medium tabular-nums">{formatDayOfMonth(day)}</span>
                <span
                  aria-hidden="true"
                  className={cn("size-1 rounded-full", isToday ? (isSelected ? "bg-on-cobalt" : "bg-cobalt") : "bg-transparent")}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Legend() {
  const items: { label: string; swatch: ReactNode }[] = [
    { label: "Yours", swatch: <span className="block h-3 w-5 rounded-chip bg-primary" /> },
    {
      label: "Pending",
      swatch: <span className="block h-3 w-5 rounded-chip border border-dashed border-st-pending-border bg-st-pending-bg" />,
    },
    {
      label: "Busy",
      swatch: (
        <span className="relative block h-3 w-5 overflow-hidden rounded-chip border border-busy-edge bg-busy">
          <span className="hatch-busy absolute inset-y-0 left-0 w-1.5" />
        </span>
      ),
    },
    { label: "Finished", swatch: <span className="block h-3 w-5 rounded-chip border border-dashed border-line-strong/70 bg-surface/70" /> },
    { label: "Maintenance", swatch: <span className="hatch block h-3 w-5 rounded-chip border border-line-strong" /> },
    { label: "Closed hours", swatch: <span className="block h-3 w-5 rounded-chip border border-line bg-sunken" /> },
    { label: "Past", swatch: <span className="block h-3 w-5 rounded-chip border border-line bg-bench" /> },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-small text-ink-muted" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true">{item.swatch}</span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
