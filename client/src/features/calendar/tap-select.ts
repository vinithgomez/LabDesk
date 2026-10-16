/**
 * Choosing a time on a phone (DESIGN.md §7): tap the first half hour, then
 * the last. Pure, like grid.ts, so it is unit tested.
 *
 * The end is inclusive (tapping 10:00 then 10:30 chooses 10:00–11:00), and
 * a range never covers something busy: it stops before the first blocked
 * row, the same rule as a desktop drag (grid.clampDrag).
 */
import { clampDrag, type SlotSpan } from "./grid";

export type TapState = { kind: "idle" } | { kind: "start"; slot: number };

export interface TapResult {
  state: TapState;
  /** The chosen rows once a range is complete; null while choosing or after clearing. */
  span: SlotSpan | null;
}

export const IDLE: TapState = { kind: "idle" };

/**
 * The next state after a tap on row `slot` of one day, whose rows are
 * `blocked` (true: can't be chosen).
 *
 * - No start yet: a free row becomes the start; a blocked row does nothing.
 * - The start again: clears it.
 * - A row before the start: that row becomes the new start (if free).
 * - A row after the start: the range from the start to it, stopped before
 *   anything busy in between, and choosing starts over.
 */
export function tapSlot(state: TapState, slot: number, blocked: readonly boolean[]): TapResult {
  const free = blocked[slot] === false;
  if (state.kind === "idle") return { state: free ? { kind: "start", slot } : IDLE, span: null };
  if (slot === state.slot) return { state: IDLE, span: null };
  if (slot < state.slot) return { state: free ? { kind: "start", slot } : state, span: null };
  // The start may have been taken since it was tapped (availability refreshed): then nothing is chosen.
  return { state: IDLE, span: clampDrag(state.slot, slot, blocked) };
}
