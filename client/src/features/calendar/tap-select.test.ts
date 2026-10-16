import { describe, expect, it } from "vitest";
import { IDLE, tapSlot, type TapState } from "./tap-select";

/** Ten half-hour rows; rows 4 and 5 are busy (say 10:00–11:00 on an 08:00 grid). */
const BLOCKED = [false, false, false, false, true, true, false, false, false, false];
const start = (slot: number): TapState => ({ kind: "start", slot });

describe("tapSlot (phone: tap a start, then an end)", () => {
  it("makes a free row the start, and chooses nothing yet", () => {
    expect(tapSlot(IDLE, 1, BLOCKED)).toEqual({ state: start(1), span: null });
  });

  it("chooses the range from the start to the tapped end, inclusive", () => {
    expect(tapSlot(start(0), 2, BLOCKED)).toEqual({ state: IDLE, span: { first: 0, last: 2 } });
    expect(tapSlot(start(6), 9, BLOCKED)).toEqual({ state: IDLE, span: { first: 6, last: 9 } });
  });

  it("treats an end before the start as a new start", () => {
    expect(tapSlot(start(3), 1, BLOCKED)).toEqual({ state: start(1), span: null });
  });

  it("keeps the start when the earlier row tapped is blocked", () => {
    expect(tapSlot(start(7), 5, BLOCKED)).toEqual({ state: start(7), span: null });
  });

  it("stops before a busy block between the start and the end, like a drag", () => {
    expect(tapSlot(start(1), 8, BLOCKED)).toEqual({ state: IDLE, span: { first: 1, last: 3 } });
  });

  it("stops before a busy row tapped as the end", () => {
    expect(tapSlot(start(2), 4, BLOCKED)).toEqual({ state: IDLE, span: { first: 2, last: 3 } });
  });

  it("clears the start when the same row is tapped twice", () => {
    const first = tapSlot(IDLE, 2, BLOCKED);
    expect(tapSlot(first.state, 2, BLOCKED)).toEqual({ state: IDLE, span: null });
  });

  it("ignores a tap on a busy row when nothing is started", () => {
    expect(tapSlot(IDLE, 4, BLOCKED)).toEqual({ state: IDLE, span: null });
  });

  it("chooses nothing if the start has been taken since it was tapped", () => {
    const nowBusy = BLOCKED.map((b, i) => b || i === 1);
    expect(tapSlot(start(1), 3, nowBusy)).toEqual({ state: IDLE, span: null });
  });

  it("starts over after a range: the next tap is a new start", () => {
    const { state } = tapSlot(start(0), 2, BLOCKED);
    expect(tapSlot(state, 7, BLOCKED)).toEqual({ state: start(7), span: null });
  });
});
