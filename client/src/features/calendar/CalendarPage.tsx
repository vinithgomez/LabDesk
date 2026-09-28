import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { describeApiError, formatDuration } from "../../lib/api-errors";
import { useNow } from "../../lib/use-now";
import { StatusBadge } from "../bookings/StatusBadge";
import { useResource, type Resource } from "../resources/use-resources";
import { BookingPanel } from "./BookingPanel";
import { formatWeek } from "./format";
import { addDays, istDayKey, istWeekStart, selectionFromSpan } from "./grid";
import { useBookingPanel } from "./use-calendar";
import { panelChoices, useWeekView, type ChosenSlot } from "./use-week-view";
import { WeekGrid, type GridSelection, type SelectVia } from "./WeekGrid";

const navButton =
  "min-h-8 rounded-md border border-slate-700 px-2.5 text-sm text-slate-200 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

/** §11 week calendar for one resource: /resources/:id */
export default function CalendarPage() {
  const { id } = useParams();
  const resource = useResource(id);
  if (resource.isPending) {
    return (
      <p role="status" className="text-sm text-slate-400">
        Loading…
      </p>
    );
  }
  if (resource.isError) {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="rounded-md bg-rose-600/20 p-2 text-sm text-rose-200">
          {describeApiError(resource.error)}
        </p>
        <Link to="/resources" className="text-sm text-indigo-300 hover:underline">
          ← All resources
        </Link>
      </div>
    );
  }
  return <ResourceCalendar key={resource.data.id} resource={resource.data} />;
}

function ResourceCalendar({ resource }: { resource: Resource }) {
  const now = useNow(30_000);
  const [weekStart, setWeekStart] = useState(() => istWeekStart(new Date()));
  const view = useWeekView(resource, weekStart, now);
  const panel = useBookingPanel(resource, weekStart);
  const [chosen, setChosen] = useState<ChosenSlot | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLSelectElement>(null);
  const selectedVia = useRef<SelectVia | null>(null);

  // Once a new selection's panel is mounted: scroll to it after a tap, focus it otherwise.
  useEffect(() => {
    if (selectedVia.current === "tap") panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    else if (selectedVia.current) endRef.current?.focus();
    selectedVia.current = null;
  }, [panelKey]);

  const today = istDayKey(now);
  const choices = chosen ? panelChoices(view, chosen, resource, now) : null;

  const changeWeek = (next: string) => {
    setWeekStart(next);
    setChosen(null);
    panel.reset();
  };

  const select = (selection: GridSelection, via: SelectVia) => {
    const day = view.days[selection.day];
    const interval = day === undefined ? null : selectionFromSpan(day, view.range, selection.span, new Date());
    if (!interval) return;
    setChosen({ ...selection, interval });
    selectedVia.current = via;
    setPanelKey((k) => k + 1);
    panel.reset();
  };

  const close = () => {
    setChosen(null);
    panel.reset();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <Link to="/resources" className="text-xs text-slate-400 hover:text-slate-200 hover:underline">
            ← All resources
          </Link>
          <h1 className="text-xl font-bold text-white">{resource.name}</h1>
          <p className="text-xs text-slate-400">
            <span className="capitalize">{resource.type}</span> · {resource.location}
            {resource.capacity > 0 && <> · up to {resource.capacity} people</>} · {formatDuration(resource.minSlotMinutes)} to{" "}
            {formatDuration(resource.maxSlotMinutes)} per booking · up to {resource.bookingHorizonDays} days ahead
            {resource.requiresApproval && <> · needs approval</>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={navButton} onClick={() => changeWeek(addDays(weekStart, -7))} aria-label="Previous week">
            ‹
          </button>
          <button type="button" className={navButton} onClick={() => changeWeek(istWeekStart(new Date()))}>
            Today
          </button>
          <button type="button" className={navButton} onClick={() => changeWeek(addDays(weekStart, 7))} aria-label="Next week">
            ›
          </button>
          <span className="ml-1 text-sm tabular-nums text-slate-300" aria-live="polite">
            {formatWeek(view.days[0] ?? weekStart, view.days[6] ?? weekStart)}
          </span>
        </div>
      </div>

      <Legend />

      {view.error !== null && (
        <p role="alert" className="rounded-md bg-rose-600/20 p-2 text-sm text-rose-200">
          {describeApiError(view.error)}
        </p>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className={view.loading ? "opacity-60" : ""} aria-busy={view.loading}>
          <WeekGrid
            days={view.days}
            today={today}
            range={view.range}
            events={view.events}
            blocked={view.blocked}
            past={view.past}
            open={view.open}
            selection={panel.outcome.kind === "booked" ? null : (chosen?.interval ?? null)}
            selectionDay={chosen?.day ?? null}
            onSelect={select}
          />
        </div>
        <div ref={panelRef} className="lg:sticky lg:top-3">
          {chosen && choices ? (
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
              onClose={close}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-slate-700 p-3 text-xs text-slate-400">
              Drag down a day to choose a time (on a phone, tap a slot), or use the arrow keys and Enter.
            </p>
          )}
        </div>
      </div>

      <p aria-live="polite" role="status" className="sr-only">
        {panel.announcement}
      </p>
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400" aria-label="Legend">
      <li className="flex items-center gap-1">
        <span className="inline-block h-3 w-4 rounded-sm border-l-2 border-indigo-200 bg-indigo-600" /> Yours
      </li>
      <li className="flex items-center gap-1">
        <span className="inline-block h-3 w-4 rounded-sm border-l-2 border-slate-400 bg-slate-600" /> Busy
      </li>
      <li className="flex items-center gap-1">
        <span
          className="inline-block h-3 w-4 rounded-sm border border-dashed border-slate-400/70 bg-slate-800"
          style={{ backgroundImage: "repeating-linear-gradient(135deg, rgb(148 163 184 / 0.4) 0 3px, transparent 3px 6px)" }}
        />{" "}
        Maintenance
      </li>
      <li className="flex items-center gap-1">
        <span className="inline-block h-3 w-4 rounded-sm bg-slate-950 ring-1 ring-slate-700" /> Closed hours
      </li>
      <li className="flex items-center gap-1">
        <span className="inline-block h-3 w-4 rounded-sm bg-black ring-1 ring-slate-800" /> Past
      </li>
      <li className="flex items-center gap-1">
        <StatusBadge status="pending" /> <StatusBadge status="approved" /> <StatusBadge status="rejected" />
      </li>
    </ul>
  );
}
