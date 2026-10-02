import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { StatusBadge } from "../bookings/StatusBadge";
import { formatDayLong, formatDayShort, formatMinute, formatTime } from "./format";
import {
  clampDrag,
  eventBox,
  moveCell,
  pxToSlot,
  slotCount,
  slotEnd,
  slotStart,
  SLOT_MINUTES,
  SLOT_PX,
  type Cell,
  type DayKey,
  type GridRange,
  type Interval,
  type SlotSpan,
} from "./grid";
import { describeCell, HOLDING, type WeekEvents } from "./model";

export interface GridSelection {
  day: number;
  span: SlotSpan;
}

export type SelectVia = "drag" | "tap" | "keyboard";

interface WeekGridProps {
  days: readonly DayKey[];
  today: DayKey;
  range: GridRange;
  events: WeekEvents;
  /** Per day, per row: can't be selected. */
  blocked: readonly (readonly boolean[])[];
  /** Per day, per row: already over. */
  past: readonly (readonly boolean[])[];
  /** Per day, per row: inside business hours and days. */
  open: readonly (readonly boolean[])[];
  /** The chosen selection, shown as a dashed block; null for none. */
  selection: Interval | null;
  selectionDay: number | null;
  onSelect: (selection: GridSelection, via: SelectVia) => void;
}

const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, rgb(148 163 184 / 0.4) 0 5px, transparent 5px 10px)",
};

/**
 * The hand-built week grid: a CSS grid of 30-minute cells (rows) by days
 * (columns), with each day's blocks absolutely positioned in a layer over
 * its column. Mouse: press and drag within a column. Touch: tap one cell,
 * then choose the length in the panel. Keyboard: arrows move, Enter or
 * Space selects.
 */
export function WeekGrid({ days, today, range, events, blocked, past, open, selection, selectionDay, onSelect }: WeekGridProps) {
  const rows = slotCount(range);
  const [drag, setDrag] = useState<{ day: number; anchor: number; reach: number; originTop: number } | null>(null);
  // The roving tab stop starts on the first free slot today (or the first cell).
  const [focus, setFocus] = useState<Cell>(() => {
    const day = Math.max(0, days.indexOf(today));
    return { day, slot: Math.max(0, blocked[day]?.indexOf(false) ?? 0) };
  });
  const cells = useRef(new Map<string, HTMLDivElement>());
  const gridRef = useRef<HTMLDivElement>(null);

  const focusCell = (cell: Cell) => {
    setFocus(cell);
    cells.current.get(`${cell.day}:${cell.slot}`)?.focus();
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>, day: number, slot: number) => {
    if (e.pointerType === "touch" || e.button !== 0 || blocked[day]?.[slot] !== false) return;
    e.preventDefault(); // no text selection while dragging
    gridRef.current?.setPointerCapture(e.pointerId);
    const originTop = e.currentTarget.getBoundingClientRect().top - slot * SLOT_PX;
    setFocus({ day, slot });
    setDrag({ day, anchor: slot, reach: slot, originTop });
  };

  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const span = clampDrag(drag.anchor, pxToSlot(e.clientY - drag.originTop, range), blocked[drag.day] ?? []);
    if (!span) return;
    const reach = span.first === drag.anchor ? span.last : span.first;
    if (reach !== drag.reach) setDrag({ ...drag, reach });
  };

  const endDrag = () => {
    if (!drag) return;
    setDrag(null);
    onSelect({ day: drag.day, span: { first: Math.min(drag.anchor, drag.reach), last: Math.max(drag.anchor, drag.reach) } }, "drag");
  };

  const tap = (e: PointerEvent<HTMLDivElement>, day: number, slot: number) => {
    // A touch that turns into a scroll is cancelled by the browser, so an up here is a tap.
    if (e.pointerType !== "touch" || blocked[day]?.[slot] !== false) return;
    setFocus({ day, slot });
    onSelect({ day, span: { first: slot, last: slot } }, "tap");
  };

  /** The cell a key event came from: the focused cell itself, which can be ahead of the roving-focus state. */
  const cellOf = (target: EventTarget): Cell => {
    const el = target instanceof HTMLElement ? target.closest<HTMLElement>("[role=gridcell]") : null;
    const day = Number(el?.dataset.dayIndex);
    const slot = Number(el?.dataset.slot);
    return Number.isInteger(day) && Number.isInteger(slot) ? { day, slot } : focus;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = cellOf(e.target);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (blocked[at.day]?.[at.slot] === false) onSelect({ day: at.day, span: { first: at.slot, last: at.slot } }, "keyboard");
      return;
    }
    const next = moveCell(at, e.key, rows);
    if (next) {
      e.preventDefault();
      focusCell(next);
    }
  };

  // While dragging, draw the drag; otherwise the chosen selection.
  const dragged: { day: number; box: Interval } | null = drag
    ? {
        day: drag.day,
        box: {
          start: slotStart(days[drag.day] ?? today, range, Math.min(drag.anchor, drag.reach)),
          end: slotEnd(days[drag.day] ?? today, range, Math.max(drag.anchor, drag.reach)),
        },
      }
    : selection && selectionDay !== null
      ? { day: selectionDay, box: selection }
      : null;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <div
        ref={gridRef}
        role="grid"
        aria-label="Week calendar. Arrow keys move between half-hour slots; Enter selects a free slot."
        aria-readonly="false"
        onKeyDown={onKeyDown}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
        className="grid min-w-[36rem] select-none"
        style={{ gridTemplateColumns: "3rem repeat(7, minmax(4.25rem, 1fr))", gridTemplateRows: `auto repeat(${rows}, ${SLOT_PX}px)` }}
      >
        <div role="row" className="contents">
          <div role="columnheader" className="sticky left-0 z-30 border-b border-slate-800 bg-slate-950" aria-label="Time" />
          {days.map((day) => (
            <div
              key={day}
              role="columnheader"
              aria-label={formatDayLong(day)}
              className={`border-b border-l border-slate-800 px-1 py-1 text-center text-xs font-semibold ${
                day === today ? "bg-indigo-500/15 text-indigo-200" : "bg-slate-950 text-slate-300"
              }`}
            >
              {formatDayShort(day)}
            </div>
          ))}
        </div>

        {Array.from({ length: rows }, (_, slot) => {
          const minute = range.startMinute + slot * SLOT_MINUTES;
          const onHour = minute % 60 === 0;
          return (
            <div key={slot} role="row" className="contents">
              <div
                role="rowheader"
                className={`sticky left-0 z-30 -mt-1.5 bg-slate-950 pr-1 text-right text-[11px] leading-3 tabular-nums text-slate-500 ${onHour ? "" : "invisible"}`}
                style={{ gridColumn: 1, gridRow: slot + 2 }}
              >
                {formatMinute(minute)}
              </div>
              {days.map((day, d) => {
                const isBlocked = blocked[d]?.[slot] !== false;
                const cell = { start: slotStart(day, range, slot), end: slotEnd(day, range, slot) };
                const focused = focus.day === d && focus.slot === slot;
                return (
                  <div
                    key={day}
                    ref={(el) => {
                      if (el) cells.current.set(`${d}:${slot}`, el);
                      else cells.current.delete(`${d}:${slot}`);
                    }}
                    role="gridcell"
                    tabIndex={focused ? 0 : -1}
                    aria-disabled={isBlocked}
                    aria-label={`${formatDayLong(day)}, ${formatTime(cell.start)} to ${formatTime(cell.end)}, ${describeCell(cell, events, isBlocked)}`}
                    data-day={day}
                    data-time={formatTime(cell.start)}
                    data-day-index={d}
                    data-slot={slot}
                    onPointerDown={(e) => startDrag(e, d, slot)}
                    onPointerUp={(e) => tap(e, d, slot)}
                    onFocus={() => setFocus({ day: d, slot })}
                    className={`relative border-l border-slate-800 focus:outline-none focus-visible:z-40 focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-300 ${
                      onHour ? "border-t border-t-slate-700/70" : "border-t border-t-slate-800/50 border-dashed"
                    } ${past[d]?.[slot] ? "bg-black/50" : open[d]?.[slot] ? "bg-slate-900" : "bg-slate-950"} ${
                      isBlocked ? "cursor-not-allowed" : "cursor-pointer hover:bg-indigo-500/10"
                    }`}
                    style={{ gridColumn: d + 2, gridRow: slot + 2 }}
                  />
                );
              })}
            </div>
          );
        })}

        {days.map((day, d) => (
          <div
            key={day}
            aria-hidden="true"
            className="pointer-events-none relative z-20"
            style={{ gridColumn: d + 2, gridRow: `2 / span ${rows}` }}
          >
            {events.maintenance.map((m, i) => (
              <Block key={`m${i}`} interval={m} day={day} range={range} className="border border-dashed border-slate-400/70 bg-slate-800/80 text-slate-200" style={HATCH}>
                Maintenance
              </Block>
            ))}
            {events.others.map((b, i) => (
              <Block key={`o${i}`} interval={b} day={day} range={range} className="border-l-2 border-slate-400 bg-slate-600/80 text-slate-100">
                Busy
              </Block>
            ))}
            {events.mine.map((b) => (
              <Block
                key={b.id}
                interval={b}
                day={day}
                range={range}
                // A slot you no longer hold (rejected, no-show) may be someone else's now: draw it half-width.
                half={!HOLDING.includes(b.status)}
                className={`border-l-2 border-indigo-200 bg-indigo-600/90 text-white ${b.optimistic ? "opacity-70" : ""}`}
              >
                <span className="flex flex-wrap items-center gap-1">
                  <StatusBadge status={b.status} />
                  {b.optimistic && <span className="text-[11px]">Saving…</span>}
                </span>
                <span className="block truncate">{b.purpose || "Your booking"}</span>
              </Block>
            ))}
            {dragged?.day === d && (
              <Block interval={dragged.box} day={day} range={range} className="z-10 border-2 border-dashed border-indigo-300 bg-indigo-400/25 text-indigo-50">
                {formatTime(dragged.box.start)}–{formatTime(dragged.box.end)}
              </Block>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Block({
  interval,
  day,
  range,
  className,
  style,
  half = false,
  children,
}: {
  interval: Interval;
  day: DayKey;
  range: GridRange;
  className: string;
  style?: CSSProperties;
  half?: boolean;
  children: ReactNode;
}) {
  const box = eventBox(interval, day, range);
  if (!box) return null;
  return (
    <div
      className={`absolute overflow-hidden rounded-sm px-1 text-[11px] leading-4 ${half ? "right-0.5 left-1/2" : "right-0.5 left-0.5"} ${className}`}
      style={{ ...style, top: box.top + 1, height: Math.max(box.height - 2, 6) }}
    >
      {children}
    </div>
  );
}
