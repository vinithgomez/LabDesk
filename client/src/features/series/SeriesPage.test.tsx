import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../lib/api";
import SeriesPage from "./SeriesPage";
import type { SeriesDetail } from "./types";
import { CANCEL_SERIES_WARNING } from "./use-series";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiRequest: vi.fn(),
}));

const ist = (local: string) => new Date(`${local}+05:30`).toISOString();
const SERIES: SeriesDetail = {
  id: "s1",
  resourceId: "r1",
  userId: "u1",
  rrule: "FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261130",
  startTime: "10:00",
  durationMinutes: 90,
  purpose: "Weekly lab",
  attendeeCount: 20,
  status: "active",
  materializedThrough: ist("2026-10-13T10:00:00"),
  cancelledAt: null,
  createdAt: "",
  occurrences: [
    { bookingId: "b1", start: ist("2026-10-06T10:00:00"), end: ist("2026-10-06T11:30:00"), status: "approved" },
    { bookingId: "b2", start: ist("2026-10-13T10:00:00"), end: ist("2026-10-13T11:30:00"), status: "pending" },
  ],
  skipped: [
    { start: ist("2026-10-08T10:00:00"), end: ist("2026-10-08T11:30:00"), reason: "SLOT_CONFLICT", message: "Slot is already booked", recordedAt: "" },
    { start: ist("2026-10-15T10:00:00"), end: ist("2026-10-15T11:30:00"), reason: "MAINTENANCE_BLOCKED", message: "x", recordedAt: "" },
  ],
};
const mocked = vi.mocked(apiRequest);
type Init = { method: string };

beforeEach(() => {
  mocked.mockImplementation((path: string, init: Init) => {
    if (path === "/api/series/s1" && init.method === "GET") return Promise.resolve(SERIES);
    if (path === "/api/series/s1" && init.method === "DELETE") return Promise.resolve({ ...SERIES, status: "cancelled" });
    if (path === "/api/resources/r1") return Promise.resolve({ id: "r1", name: "Systems Lab" });
    return Promise.reject(new Error(`unexpected ${init.method} ${path}`));
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/series/s1"]}>
        <Routes>
          <Route path="/series/:id" element={<SeriesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("series detail", () => {
  it("describes the rule and lists booked and skipped dates, with why each was skipped", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Repeating booking · Systems Lab" })).toBeInTheDocument();
    expect(screen.getByText(/Every Tue and Thu until Mon 30 Nov 2026, 10:00 for 1 h 30 min \(IST\)/)).toBeInTheDocument();

    const booked = screen.getByRole("heading", { name: /Booked dates/ }).parentElement as HTMLElement;
    expect(within(booked).getByText("Tue 6 Oct, 10:00–11:30")).toBeInTheDocument();
    expect(within(booked).getByText("Pending")).toBeInTheDocument();

    const skipped = screen.getByRole("heading", { name: /Skipped dates/ }).parentElement as HTMLElement;
    expect(within(skipped).getByText("Thu 8 Oct, 10:00–11:30")).toBeInTheDocument();
    expect(within(skipped).getByText("Someone else already had that time booked.")).toBeInTheDocument();
    expect(within(skipped).getByText("The resource was closed for maintenance then.")).toBeInTheDocument();
    expect(within(skipped).queryByText("Slot is already booked")).not.toBeInTheDocument();
  });

  it("cancels only after a confirm that says what is and isn't touched", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Cancel series…" }));
    const confirm = screen.getByRole("group", { name: "Confirm cancelling the series" });
    expect(confirm).toHaveTextContent(CANCEL_SERIES_WARNING);
    expect(CANCEL_SERIES_WARNING).toMatch(/already started, are checked in, or are over are not touched/);
    expect(mocked.mock.calls.filter(([, init]) => init.method === "DELETE")).toHaveLength(0);

    await user.click(within(confirm).getByRole("button", { name: "Cancel the series" }));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledWith("/api/series/s1", { method: "DELETE" });
    expect(screen.queryByRole("button", { name: "Cancel series…" })).not.toBeInTheDocument();
  });
});
