import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../lib/api";
import MyBookingsPage from "./MyBookingsPage";
import type { Booking, WaitlistEntry } from "./types";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiRequest: vi.fn(),
}));

const ist = (local: string) => new Date(`${local}+05:30`).toISOString();
const booking = (over: Partial<Booking>): Booking => ({
  id: "b1",
  resourceId: "r1",
  userId: "me",
  start: ist("2026-10-06T10:00:00"),
  end: ist("2026-10-06T11:00:00"),
  status: "approved",
  purpose: "Weekly lab",
  attendeeCount: 1,
  seriesId: null,
  cancelledByMaintenanceId: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});
const entry = (over: Partial<WaitlistEntry>): WaitlistEntry => ({
  id: "w1",
  resourceId: "r1",
  userId: "me",
  desiredPeriod: { start: ist("2026-10-07T14:00:00"), end: ist("2026-10-07T15:00:00") },
  purpose: "Project demo",
  attendeeCount: 3,
  status: "waiting",
  bookingId: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const mocked = vi.mocked(apiRequest);
type Init = { method: string };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(ist("2026-10-05T09:00:00")));
  mocked.mockImplementation((path: string, init: Init) => {
    if (path.startsWith("/api/bookings?")) {
      return Promise.resolve(path.includes("&to=") ? [] : [booking({ seriesId: "s9" }), booking({ id: "b2", purpose: "One-off" })]);
    }
    if (path === "/api/resources") return Promise.resolve([{ id: "r1", name: "Systems Lab" }]);
    if (path === "/api/calendar/feed") return Promise.resolve({ url: "http://x/feed.ics" });
    if (path.startsWith("/api/waitlist?")) {
      return Promise.resolve([
        entry({}),
        entry({ id: "w2", status: "promoted", bookingId: "b7", purpose: "Got it" }),
        entry({ id: "w3", status: "expired", purpose: "Too late" }),
      ]);
    }
    if (path === "/api/waitlist/w1" && init.method === "DELETE") return Promise.resolve(entry({ status: "cancelled" }));
    return Promise.reject(new Error(`unexpected ${init.method} ${path}`));
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MyBookingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("my bookings: series and waitlist", () => {
  it("badges a series date with a link to the series, and not a one-off", async () => {
    renderPage();
    const seriesRow = (await screen.findByText("Weekly lab")).closest("tr") as HTMLElement;
    expect(within(seriesRow).getByRole("link", { name: "Repeats weekly: open the series" })).toHaveAttribute("href", "/series/s9");
    const oneOff = screen.getByText("One-off").closest("tr") as HTMLElement;
    expect(within(oneOff).queryByRole("link", { name: /Repeats/ })).not.toBeInTheDocument();
  });

  it("lists my waitlist entries with their status, and lets me leave a waiting one after confirming", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Waitlist" }));

    const waiting = (await screen.findByText("Project demo")).closest("tr") as HTMLElement;
    expect(within(waiting).getByText("Wed 7 Oct, 14:00–15:00")).toBeInTheDocument();
    expect(within(waiting).getByText("Waiting")).toBeInTheDocument();
    const promoted = screen.getByText("Got it").closest("tr") as HTMLElement;
    expect(within(promoted).getByText("Booked for you")).toBeInTheDocument();
    expect(within(promoted).queryByRole("button")).not.toBeInTheDocument();
    expect(within(screen.getByText("Too late").closest("tr") as HTMLElement).getByText("Expired")).toBeInTheDocument();

    await user.click(within(waiting).getByRole("button", { name: "Leave" }));
    expect(mocked.mock.calls.some(([, init]) => init.method === "DELETE")).toBe(false);
    await user.click(within(waiting).getByRole("button", { name: "Leave the waitlist" }));
    expect(mocked).toHaveBeenCalledWith("/api/waitlist/w1", { method: "DELETE" });
  });

  it("moves between the three tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    renderPage();
    const upcoming = await screen.findByRole("tab", { name: /Upcoming/ });
    upcoming.focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Waitlist" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Upcoming/ })).toHaveAttribute("aria-selected", "true");
  });
});
