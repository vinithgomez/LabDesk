import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Ban, CircleCheckBig, type LucideIcon, UserX, XCircle } from "lucide-react";
import { cn, ICON_STROKE } from "../../components/ui";
import { STATUS_LABEL } from "../bookings/status";
import { formatDayLong, formatDayOfMonth, formatMinute, formatSpan, formatTime, formatWeekday } from "./format";
import {
  clampDrag,
  eventBox,
  istMinuteOfDay,
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
import { describeCell, HOLDING, type MineBlock, type WeekEvents } from "./model";

export interface GridSelection {
  day: number;
  span: SlotSpan;
}

export type SelectVia = "drag" | "tap" | "keyboard";

interface WeekGridProps {
  days: readonly DayKey[];
  today: DayKey;
  now: Date;
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
  /** Height of one half-hour row, px. The pixel maths in grid.ts is in SLOT_PX units and is scaled to this. */
  rowPx?: number;
  /**
   * "week": pointer drag on desktop, a single tap on touch. "day" (phones):
   * every tap goes to onTap, which chooses a start and then an end.
   */
  mode?: "week" | "day";
  onTap?: (day: number, slot: number) => void;
  /** Day mode: the start already tapped, drawn as a dashed row. */
  pendingStart?: { day: number; slot: number } | null;
  /** The booking that has just been made: it settles into place. */
  settleId?: string | null;
}

/**
 * The hand-built week grid (DESIGN.md §7): a ruler time axis, graph-paper
 * rows of 30 minutes by day columns, and each day's blocks absolutely
 * positioned in a layer over its column. Mouse: press and drag within a
 * column. Touch: tap (one cell in the week, start then end in day mode).
 * Keyboard: arrows move, Enter or Space selects.
 */
export function WeekGrid({
  days,
  today,
  now,
  range,
  events,
  blocked,
  past,
  open,
  selection,
  selectionDay,
  onSelect,
  rowPx = 28,
  mode = "week",
  onTap,
  pendingStart = null,
  settleId = null,
}: WeekGridProps) {
  const rows = slotCount(range);
  const scale = rowPx / SLOT_PX;
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
    if (mode === "day" || e.pointerType === "touch" || e.button !== 0 || blocked[day]?.[slot] !== false) return;
    e.preventDefault(); // no text selection while dragging
    gridRef.current?.setPointerCapture(e.pointerId);
    const originTop = e.currentTarget.getBoundingClientRect().top - slot * rowPx;
    setFocus({ day, slot });
    setDrag({ day, anchor: slot, reach: slot, originTop });
  };

  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const span = clampDrag(drag.anchor, pxToSlot((e.clientY - drag.originTop) / scale, range), blocked[drag.day] ?? []);
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
    if (mode === "day") {
      // Any pointer: a phone taps, and a narrow desktop window clicks.
      setFocus({ day, slot });
      onTap?.(day, slot);
      return;
    }
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
      focusCell({ ...next, day: Math.min(next.day, days.length - 1) });
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

  const todayIndex = days.indexOf(today);
  const nowMinute = istMinuteOfDay(now);
  const nowTop =
    todayIndex >= 0 && nowMinute >= range.startMinute && nowMinute < range.endMinute
      ? ((nowMinute - range.startMinute) / SLOT_MINUTES) * rowPx
      : null;
  const axis = mode === "day" ? "3.25rem" : "3.5rem";

  return (
    <div className={cn("rounded-panel border border-line bg-surface", mode === "week" && "overflow-x-auto")}>
      <div
        ref={gridRef}
        role="grid"
        aria-label="Week calendar. Arrow keys move between half-hour slots; Enter selects a free slot."
        aria-readonly="false"
        onKeyDown={onKeyDown}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
        className={cn("grid select-none pb-2", mode === "week" && "min-w-[34rem]")}
        style={{
          gridTemplateColumns: `${axis} repeat(${days.length}, minmax(0, 1fr))`,
          gridTemplateRows: `auto repeat(${rows}, ${rowPx}px)`,
        }}
      >
        <div role="row" className="contents">
          <div role="columnheader" className={cn("border-b border-line", mode === "day" && "h-3")} aria-label="Time" />
          {days.map((day) => (
            <div
              key={day}
              role="columnheader"
              aria-label={formatDayLong(day)}
              className={cn(
                "flex flex-col items-center gap-0 border-b border-l border-b-line border-l-grid-hour px-1 pt-2 pb-1.5",
                day === today && "bg-cobalt-tint",
                mode === "day" && "sr-only",
              )}
            >
              <span className={cn("text-meta", day === today ? "font-medium text-cobalt" : "text-ink-muted")}>
                {formatWeekday(day)}
              </span>
              <span
                className={cn(
                  "font-condensed text-lead leading-tight font-medium tabular-nums",
                  day === today ? "text-cobalt" : "text-ink",
                )}
              >
                {formatDayOfMonth(day)}
              </span>
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
                aria-label={formatMinute(minute)}
                className="relative"
                style={{ gridColumn: 1, gridRow: slot + 2 }}
              >
                {/* The ruler: a long tick at each hour, a short one at each half hour. */}
                <span
                  aria-hidden="true"
                  className={cn("absolute top-0 right-0 h-px", onHour ? "w-2.5 bg-ink-faint" : "w-1.5 bg-ink-faint/60")}
                />
                {onHour && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 right-3.5 -translate-y-1/2 font-condensed text-meta leading-none text-ink-muted tabular-nums"
                  >
                    {formatMinute(minute)}
                  </span>
                )}
              </div>
              {days.map((day, d) => {
                const isBlocked = blocked[d]?.[slot] !== false;
                const isPast = past[d]?.[slot] === true;
                const isOpen = open[d]?.[slot] === true;
                const cell = { start: slotStart(day, range, slot), end: slotEnd(day, range, slot) };
                const focused = focus.day === d && focus.slot === slot;
                const holds = describeCell(cell, events, isBlocked);
                // A booking of yours under this cell: its whole time, which its block may be too small to show.
                const yours = events.mine.find((m) => m.start < cell.end && cell.start < m.end);
                const label = `${formatDayLong(day)}, ${formatTime(cell.start)} to ${formatTime(cell.end)}, ${holds}${
                  yours ? `, booked ${formatTime(yours.start)} to ${formatTime(yours.end)}` : ""
                }`;
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
                    aria-label={label}
                    // The same words as a tooltip, wherever something is drawn over the cell.
                    title={holds === "free" || holds === "unavailable" ? undefined : label}
                    data-day={day}
                    data-time={formatTime(cell.start)}
                    data-day-index={d}
                    data-slot={slot}
                    onPointerDown={(e) => startDrag(e, d, slot)}
                    onPointerUp={(e) => tap(e, d, slot)}
                    onFocus={() => setFocus({ day: d, slot })}
                    className={cn(
                      "relative border-t border-l border-l-grid-hour focus-visible:z-40 focus-visible:outline-2 focus-visible:-outline-offset-2",
                      onHour ? "border-t-grid-hour" : "border-t-grid-half",
                      isPast ? "bg-bench" : !isOpen ? "bg-sunken" : day === today ? "bg-cobalt-tint/45" : "bg-surface",
                      isBlocked ? "cursor-default" : "cursor-pointer hover:bg-cobalt-tint",
                    )}
                    style={{ gridColumn: d + 2, gridRow: slot + 2 }}
                  />
                );
              })}
            </div>
          );
        })}

        {/* Over the axis: the closing time at the bottom of the ruler, and the "now" notch. */}
        <div aria-hidden="true" className="pointer-events-none relative z-30" style={{ gridColumn: 1, gridRow: `2 / span ${rows}` }}>
          {range.endMinute % 60 === 0 && (
            <>
              <span className="absolute right-0 bottom-0 h-px w-2.5 bg-ink-faint" />
              <span className="absolute right-3.5 bottom-0 translate-y-1/2 font-condensed text-meta leading-none text-ink-muted tabular-nums">
                {formatMinute(range.endMinute)}
              </span>
            </>
          )}
          {nowTop !== null && (
            <span
              className="absolute right-0 h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[7px] border-y-transparent border-l-cobalt"
              style={{ top: nowTop }}
            />
          )}
        </div>

        {days.map((day, d) => (
          <div
            key={day}
            aria-hidden="true"
            className="pointer-events-none relative z-20"
            style={{ gridColumn: d + 2, gridRow: `2 / span ${rows}` }}
          >
            {events.maintenance.map((m, i) => (
              <Block key={`m${i}`} interval={m} day={day} range={range} scale={scale} className="hatch border border-line-strong text-ink">
                {() => [<span className="inline-block max-w-full truncate rounded-chip bg-surface/90 px-1 align-top font-medium">Maintenance</span>]}
              </Block>
            ))}
            {events.others.map((b, i) => (
              <Block
                key={`o${i}`}
                interval={b}
                day={day}
                range={range}
                scale={scale}
                className="border border-busy-edge bg-busy pl-2.5 text-ink-muted"
                edge={<span className="hatch-busy absolute inset-y-0 left-0 w-1.5 border-r border-busy-edge" />}
              >
                {() => ["Busy"]}
              </Block>
            ))}
            {events.mine.map((b) => (
              <MineBlockView
                key={b.id}
                block={b}
                day={day}
                range={range}
                scale={scale}
                settle={b.id === settleId}
                // A finished booking shares its column only if something else is drawn over the same time.
                crowded={[...events.others, ...events.maintenance, ...events.mine.filter((m) => m !== b)].some(
                  (x) => x.start < b.end && b.start < x.end,
                )}
              />
            ))}
            {dragged?.day === d && (
              <Block
                interval={dragged.box}
                day={day}
                range={range}
                scale={scale}
                className="z-10 border-2 border-dashed border-cobalt bg-cobalt-tint/80 font-medium text-cobalt"
              >
                {(lines) => {
                  // "11:00 to 12:00, 1 h" on one line when there is only one, else broken after the times.
                  const label = formatSpan(dragged.box.start, dragged.box.end);
                  const cut = label.indexOf(", ") + 1;
                  return lines === 1 ? [label] : [label.slice(0, cut), label.slice(cut + 1)];
                }}
              </Block>
            )}
            {pendingStart?.day === d && (
              <Block
                interval={{ start: slotStart(day, range, pendingStart.slot), end: slotEnd(day, range, pendingStart.slot) }}
                day={day}
                range={range}
                scale={scale}
                className="z-10 border-2 border-dashed border-cobalt bg-cobalt-tint/80 font-medium text-cobalt"
              >
                {() => [`From ${formatTime(slotStart(day, range, pendingStart.slot))}`]}
              </Block>
            )}
            {d === todayIndex && nowTop !== null && (
              // A surface-coloured edge keeps the line visible where it crosses one of your (cobalt) bookings.
              <span className="absolute inset-x-0 z-30 h-0.5 -translate-y-1/2 bg-cobalt shadow-[0_0_0_1px_var(--surface)]" style={{ top: nowTop }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const ENDED_ICON: Partial<Record<MineBlock["status"], LucideIcon>> = { completed: CircleCheckBig, no_show: UserX, rejected: XCircle };

/**
 * One of your own bookings: solid cobalt when held, amber and dashed while
 * pending. A finished one (completed, no-show, rejected) is drawn lighter:
 * full width, unless something else is drawn over the same time
 * (`crowded`), when it keeps to the right half so both stay visible.
 */
function MineBlockView({
  block: b,
  day,
  range,
  scale,
  settle,
  crowded,
}: {
  block: MineBlock;
  day: DayKey;
  range: GridRange;
  scale: number;
  settle: boolean;
  crowded: boolean;
}) {
  const time = `${formatTime(b.start)}–${formatTime(b.end)}`;
  const purpose = b.purpose || "Your booking";
  if (!HOLDING.includes(b.status)) {
    const Icon = ENDED_ICON[b.status] ?? Ban;
    // The time never breaks mid-number: the whole range where the block is wide enough, else the start
    // time, else just the icon. The cell's label and tooltip carry everything in words.
    const when = (
      <span className="flex min-w-0 items-center gap-1 font-condensed font-medium tabular-nums">
        <Icon aria-hidden="true" size={12} strokeWidth={ICON_STROKE} className="shrink-0" />
        <span className="hidden whitespace-nowrap @min-[5rem]:inline">{time}</span>
        <span className="hidden whitespace-nowrap @min-[3.25rem]:inline @min-[5rem]:hidden">{formatTime(b.start)}</span>
      </span>
    );
    return (
      <Block
        interval={b}
        day={day}
        range={range}
        scale={scale}
        half={crowded}
        className="@container border border-dashed border-line-strong/70 bg-surface/70 px-1 text-ink-muted"
      >
        {(lines) => (lines === 1 ? [when] : [when, STATUS_LABEL[b.status]])}
      </Block>
    );
  }
  const pending = b.status === "pending";
  const head = pending ? "Pending" : b.status === "checked_in" ? "Checked in" : null;
  const saving = b.optimistic ? <span className="font-normal"> Saving…</span> : null;
  const timeText = <span className="font-medium tabular-nums">{time}</span>;
  return (
    <Block
      interval={b}
      day={day}
      range={range}
      scale={scale}
      className={cn(
        pending ? "border border-dashed border-st-pending-border bg-st-pending-bg text-st-pending-fg" : "bg-primary text-on-cobalt",
        b.optimistic && "opacity-70",
        settle && "animate-settle",
      )}
    >
      {(lines) => {
        if (lines === 1) {
          return [
            <>
              {head && <span className="font-semibold">{head} </span>}
              {timeText} {purpose}
              {saving}
            </>,
          ];
        }
        if (head && lines >= 3) {
          return [
            <span className="font-semibold">{head}</span>,
            <>
              {timeText}
              {saving}
            </>,
            purpose,
          ];
        }
        return [
          <>
            {head && <span className="font-semibold">{head} </span>}
            {timeText}
            {saving}
          </>,
          purpose,
        ];
      }}
    </Block>
  );
}

/**
 * A block in a day column. Its content is a list of lines for the number
 * of whole lines that fit; each is cut with an ellipsis, and lines that
 * don't fit aren't drawn, so text is never clipped mid-line.
 */
function Block({
  interval,
  day,
  range,
  scale,
  className,
  half = false,
  edge,
  children,
}: {
  interval: Interval;
  day: DayKey;
  range: GridRange;
  scale: number;
  className: string;
  half?: boolean;
  /** Decoration at the left edge (the hatch on someone else's booking). */
  edge?: ReactNode;
  /** The lines to show, given how many whole lines fit (at least one). */
  children: (lines: number) => ReactNode[];
}) {
  const box = eventBox(interval, day, range);
  if (!box) return null;
  const height = Math.max(box.height * scale - 2, 6);
  // 16px lines inside 4px of padding top and bottom; a half hour fits one, centred.
  const lines = Math.max(1, Math.floor((height - 8) / 16));
  const content = children(lines).slice(0, lines);
  return (
    <div
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-chip px-1.5 text-meta leading-4",
        lines === 1 ? "justify-center py-0" : "py-1",
        half ? "right-[3px] left-1/2" : "right-[3px] left-[3px]",
        className,
      )}
      style={{ top: box.top * scale + 1, height }}
    >
      {edge}
      {content.map((line, i) => (
        <span key={i} className="block min-w-0 truncate">
          {line}
        </span>
      ))}
    </div>
  );
}
