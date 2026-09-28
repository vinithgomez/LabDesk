import { useMemo } from "react";
import type { Resource } from "../resources/use-resources";
import {
  blockedSlots,
  defaultEnd,
  endOptions,
  gridRange,
  slotCount,
  SLOT_MINUTES,
  weekDays,
  type DayKey,
  type GridRange,
  type Interval,
  type SlotSpan,
} from "./grid";
import { isOpen, weekEvents, type WeekEvents } from "./model";
import { useAvailability, useMyWeekBookings } from "./use-calendar";

const DAY_MS = 86_400_000;

export interface WeekView {
  days: DayKey[];
  events: WeekEvents;
  range: GridRange;
  blocked: boolean[][];
  open: boolean[][];
  loading: boolean;
  error: unknown;
}

/** Everything the week grid draws for one resource-week, derived from the two queries. */
export function useWeekView(resource: Resource, weekStart: DayKey, now: Date): WeekView {
  const availability = useAvailability(resource.id, weekStart);
  const mine = useMyWeekBookings(resource.id, weekStart);
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const events = useMemo(() => weekEvents(availability.data?.busy ?? [], mine.data ?? []), [availability.data, mine.data]);
  const range = useMemo(
    () =>
      gridRange(
        { start: resource.businessHoursStart, end: resource.businessHoursEnd },
        [...events.others, ...events.maintenance, ...events.mine],
        days,
      ),
    [resource.businessHoursStart, resource.businessHoursEnd, events, days],
  );
  const blocked = useMemo(() => days.map((day) => blockedSlots(day, range, events.blocking, now)), [days, range, events, now]);
  const open = useMemo(
    () =>
      days.map((day) =>
        Array.from({ length: slotCount(range) }, (_, slot) => isOpen(day, range.startMinute + slot * SLOT_MINUTES, resource)),
      ),
    [days, range, resource],
  );
  return {
    days,
    events,
    range,
    blocked,
    open,
    loading: availability.isPending || mine.isPending,
    error: availability.error ?? mine.error,
  };
}

export interface ChosenSlot {
  day: number;
  span: SlotSpan;
  /** Fixed when chosen, so the request doesn't drift while the panel is open. */
  interval: Interval;
}

/** The ends the panel offers for a chosen slot, and which one it starts on. */
export function panelChoices(view: WeekView, chosen: ChosenSlot, resource: Resource, now: Date) {
  const day = view.days[chosen.day];
  if (day === undefined) return { options: [], initialEnd: null };
  const options = endOptions(day, view.range, chosen.interval.start, view.blocked[chosen.day] ?? [], {
    minSlotMinutes: resource.minSlotMinutes,
    maxSlotMinutes: resource.maxSlotMinutes,
    latestEnd: new Date(now.getTime() + resource.bookingHorizonDays * DAY_MS),
  });
  return { options, initialEnd: defaultEnd(options, chosen.interval.end) };
}
