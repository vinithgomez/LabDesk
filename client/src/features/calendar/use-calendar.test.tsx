import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../lib/api";
import type { Resource } from "../resources/use-resources";
import { useBookingPanel } from "./use-calendar";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiRequest: vi.fn(),
}));

const RESOURCE = { id: "r1", name: "Systems Lab", capacity: 40, minSlotMinutes: 30, maxSlotMinutes: 180, bookingHorizonDays: 14, requiresApproval: false } as Resource;

describe("useBookingPanel.bookSeries", () => {
  it("sends one POST /api/series however many times it's called while one is in flight", async () => {
    let answer: (v: unknown) => void = () => {};
    vi.mocked(apiRequest).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBookingPanel(RESOURCE, "2026-09-28"), { wrapper });

    const draft = { start: new Date("2026-09-29T04:30:00Z"), end: new Date("2026-09-29T05:30:00Z"), purpose: "", attendeeCount: 1 };
    const repeat = { days: [2], until: "2026-11-30" };
    let first: Promise<void> = Promise.resolve();
    act(() => {
      // Same tick, before any re-render could disable a button.
      first = result.current.bookSeries(draft, repeat);
      void result.current.bookSeries(draft, repeat);
      void result.current.bookSeries(draft, repeat);
    });
    // The mutation starts asynchronously: wait for it, then give any extra calls time to appear.
    await vi.waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalled());
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(vi.mocked(apiRequest)).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer({ id: "s1", occurrences: [], skipped: [] });
      await first;
    });
    expect(result.current.outcome.kind).toBe("seriesCreated");

    // Once it has answered, a new submit goes through.
    act(() => void result.current.bookSeries(draft, repeat));
    await vi.waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledTimes(2));
  });
});
