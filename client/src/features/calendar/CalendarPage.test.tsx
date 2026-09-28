import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "../../lib/api";
import type { BusyInterval } from "../bookings/types";
import type { Resource } from "../resources/use-resources";
import CalendarPage from "./CalendarPage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiRequest: vi.fn(),
}));

const RESOURCE: Resource = {
  id: "11111111-1111-4111-8111-111111111111",
  departmentId: "d1",
  name: "Systems Lab",
  type: "lab",
  location: "Block A",
  capacity: 40,
  description: "",
  requiresApproval: false,
  approvalLevels: 1,
  minSlotMinutes: 60,
  maxSlotMinutes: 180,
  bookingHorizonDays: 14,
  businessHoursStart: "08:00",
  businessHoursEnd: "18:00",
  businessDays: [1, 2, 3, 4, 5],
  isActive: true,
  ownerIds: [],
};

const ist = (local: string) => new Date(`${local}+05:30`).toISOString();
const WINNER: BusyInterval = { kind: "booking", start: ist("2026-09-29T10:00:00"), end: ist("2026-09-29T11:00:00"), status: "approved" };

type Init = { method: string; body?: unknown; headers?: Record<string, string> };
const mocked = vi.mocked(apiRequest);

/**
 * A fake API: availability is `busy` (mutable), bookings POST does `onBook`.
 * With `hangMine`, refetching your bookings never answers, so only the
 * rollback can take an optimistic block away.
 */
function fakeApi(onBook: (init: Init) => Promise<unknown>) {
  const state = { busy: [] as BusyInterval[], hangMine: false };
  mocked.mockImplementation((path: string, init: Init) => {
    if (path === `/api/resources/${RESOURCE.id}`) return Promise.resolve(RESOURCE);
    if (path.includes("/availability")) return Promise.resolve({ resourceId: RESOURCE.id, from: "", to: "", busy: state.busy });
    if (path.startsWith("/api/bookings?")) return state.hangMine ? new Promise(() => {}) : Promise.resolve([]);
    if (path === "/api/bookings" && init.method === "POST") return onBook(init);
    if (path === "/api/waitlist") return Promise.resolve({ id: "w1" });
    return Promise.reject(new Error(`unexpected ${init.method} ${path}`));
  });
  return state;
}

function renderCalendar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/resources/${RESOURCE.id}`]}>
        <Routes>
          <Route path="/resources/:id" element={<CalendarPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Keyboard-select Tuesday 10:00 and open the panel. */
async function selectTuesdayTen(user: ReturnType<typeof userEvent.setup>) {
  const cell = await screen.findByRole("gridcell", { name: /^Tuesday 29 September, 10:00 to 10:30/ });
  cell.focus();
  await user.keyboard("{Enter}");
  return screen.findByRole("form", { name: "New booking" });
}

const bookCalls = () => mocked.mock.calls.filter(([path, init]) => path === "/api/bookings" && init.method === "POST");

beforeEach(() => {
  // Monday 28 September 2026, 09:00 IST. Only Date is faked; timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(ist("2026-09-28T09:00:00")));
});
afterEach(() => vi.useRealTimers());

describe("booking from the calendar", () => {
  it("recovers from a 409: rolls back, shows the winner, explains, and offers the waitlist", async () => {
    const user = userEvent.setup();
    const api = fakeApi(() => {
      api.busy = [WINNER]; // someone else got there first
      api.hangMine = true;
      return Promise.reject(new ApiError(409, "SLOT_CONFLICT", "Slot is already booked"));
    });
    renderCalendar();

    const panel = await selectTuesdayTen(user);
    expect(within(panel).getByRole("heading")).toHaveTextContent("Tue 29 Sep, 10:00–11:00");
    await user.type(within(panel).getByLabelText("Purpose"), "Networks lab");
    await user.click(within(panel).getByRole("button", { name: "Book" }));

    // The panel stays open with one sentence about what happened.
    expect(
      await within(panel).findByText(/Someone else has just booked part of that time/),
    ).toBeInTheDocument();
    // Availability was refetched: the winner's block is on the grid, as plain "busy".
    expect(await screen.findByRole("gridcell", { name: /^Tuesday 29 September, 10:00 to 10:30, busy$/ })).toBeInTheDocument();
    // The optimistic block is gone, and the time can't be booked again from here.
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
    expect(screen.queryByRole("gridcell", { name: /your booking/ })).not.toBeInTheDocument();
    await waitFor(() => expect(within(panel).queryByRole("button", { name: /Book|Try again/ })).not.toBeInTheDocument());
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent(/^Not booked\. Someone else/);

    // The request carried an Idempotency-Key.
    const [[, init]] = bookCalls() as [[string, Init]];
    expect(init.headers?.["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.body).toMatchObject({ resourceId: RESOURCE.id, purpose: "Networks lab", attendeeCount: 1 });

    // Join the waitlist for the same time, from the same panel.
    await user.click(within(panel).getByRole("button", { name: "Join the waitlist" }));
    expect(await within(panel).findByText(/You're on the waitlist/)).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledWith("/api/waitlist", {
      method: "POST",
      body: {
        resourceId: RESOURCE.id,
        desiredPeriod: { start: ist("2026-09-29T10:00:00"), end: ist("2026-09-29T11:00:00") },
        purpose: "Networks lab",
        attendeeCount: 1,
      },
    });
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("Added to the waitlist for Tue 29 Sep, 10:00–11:00.");
  });

  it("reuses the Idempotency-Key when retrying after a network failure, and not for a changed request", async () => {
    const user = userEvent.setup();
    let calls = 0;
    fakeApi((init) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new ApiError(0, "NETWORK", "offline"));
      if (calls === 2) return Promise.reject(new ApiError(503, "HTTP_ERROR", "unavailable"));
      return Promise.resolve({ ...(init.body as object), id: "b1", status: "approved" });
    });
    renderCalendar();

    const panel = await selectTuesdayTen(user);
    await user.click(within(panel).getByRole("button", { name: "Book" }));
    await within(panel).findByText(/Couldn't reach LabDesk/);
    await user.click(within(panel).getByRole("button", { name: "Try again" }));
    await within(panel).findByText(/HTTP 503/);
    // The request changes: a new attempt.
    await user.type(within(panel).getByLabelText("Purpose"), "x");
    await user.click(within(panel).getByRole("button", { name: "Try again" }));
    await within(panel).findByText("Booked and approved.");

    const keys = bookCalls().map(([, init]) => init.headers?.["Idempotency-Key"]);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("Booked Tue 29 Sep, 10:00–11:00. Approved.");
  });

  it.each([
    ["SLOT_TOO_LONG", 422, "That's too long: Systems Lab can be booked for at most 3 hours at a time."],
    ["CAPACITY_EXCEEDED", 422, "Too many people: Systems Lab holds at most 40."],
    ["OUTSIDE_HORIZON", 422, "That's too far ahead: Systems Lab can only be booked up to 14 days in advance."],
    ["MULTI_DAY_NOT_SUPPORTED", 422, "A booking has to start and end on the same day (India time)."],
    ["MAINTENANCE_BLOCKED", 409, "Systems Lab is closed for maintenance during that time."],
    ["WRONG_DEPARTMENT", 403, "Systems Lab belongs to another department; you can only book resources in your own department."],
  ])("explains %s in one sentence with the resource's limit, and offers no waitlist", async (code, status, sentence) => {
    const user = userEvent.setup();
    fakeApi(() => Promise.reject(new ApiError(status, code, "server wording")));
    renderCalendar();

    const panel = await selectTuesdayTen(user);
    await user.click(within(panel).getByRole("button", { name: "Book" }));
    expect(await within(panel).findByText(sentence)).toBeInTheDocument();
    expect(within(panel).queryByText("server wording")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Join the waitlist" })).not.toBeInTheDocument();
  });
});
