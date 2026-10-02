import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  owners: [],
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
function fakeApi(onBook: (init: Init) => Promise<unknown>, onSeries: (init: Init) => Promise<unknown> = () => Promise.reject(new Error("no series expected"))) {
  const state = { busy: [] as BusyInterval[], hangMine: false };
  mocked.mockImplementation((path: string, init: Init) => {
    if (path === `/api/resources/${RESOURCE.id}`) return Promise.resolve(RESOURCE);
    if (path.includes("/availability")) return Promise.resolve({ resourceId: RESOURCE.id, from: "", to: "", busy: state.busy });
    if (path.startsWith("/api/bookings?")) return state.hangMine ? new Promise(() => {}) : Promise.resolve([]);
    if (path === "/api/bookings" && init.method === "POST") return onBook(init);
    if (path === "/api/waitlist") return Promise.resolve({ id: "w1" });
    if (path === "/api/series" && init.method === "POST") return onSeries(init);
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

describe("repeating a booking weekly", () => {
  const seriesCalls = () => mocked.mock.calls.filter(([path]) => path === "/api/series");
  const created = {
    id: "s1",
    occurrences: [{ bookingId: "b1", start: ist("2026-09-29T10:00:00"), end: ist("2026-09-29T11:00:00"), status: "approved" }],
    skipped: [{ start: ist("2026-10-06T10:00:00"), end: ist("2026-10-06T11:00:00"), reason: "SLOT_CONFLICT", message: "", recordedAt: "" }],
  };

  it("sends exactly FREQ=WEEKLY;BYDAY=…;UNTIL=… with the slot's IST time and length", async () => {
    const user = userEvent.setup();
    fakeApi(() => Promise.reject(new Error("no single booking expected")), () => Promise.resolve(created));
    renderCalendar();
    const panel = await selectTuesdayTen(user);
    await user.type(within(panel).getByLabelText("Purpose"), "Weekly lab");
    await user.click(within(panel).getByLabelText("Repeat weekly"));
    // Tuesday is pre-ticked; add Thursday and set the end date.
    expect(within(panel).getByRole("checkbox", { name: "Tue" })).toBeChecked();
    await user.click(within(panel).getByRole("checkbox", { name: "Thu" }));
    const until = within(panel).getByLabelText("Repeat weekly until");
    await user.clear(until);
    await user.type(until, "2026-11-30");
    await user.click(within(panel).getByRole("button", { name: "Book every week" }));

    expect(await within(panel).findByText(/Repeating booking created: 1 date booked, 1 skipped\./)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "View the series" })).toHaveAttribute("href", "/series/s1");
    expect(seriesCalls()).toEqual([
      [
        "/api/series",
        {
          method: "POST",
          body: {
            resourceId: RESOURCE.id,
            rrule: "FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261130",
            startTime: "10:00",
            durationMinutes: 60,
            purpose: "Weekly lab",
            attendeeCount: 1,
          },
        },
      ],
    ]);
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("Repeating booking created: 1 date booked, 1 skipped.");
  });

  it("guards against a double submit: one request while one is in flight", async () => {
    const user = userEvent.setup();
    let answer: (v: unknown) => void = () => {};
    fakeApi(() => Promise.reject(new Error("no single booking expected")), () => new Promise((resolve) => (answer = resolve)));
    renderCalendar();
    const panel = await selectTuesdayTen(user);
    await user.click(within(panel).getByLabelText("Repeat weekly"));
    const book = within(panel).getByRole("button", { name: "Book every week" });
    await user.dblClick(book);
    await user.keyboard("{Enter}");
    expect(within(panel).getByRole("button", { name: "Booking…" })).toBeDisabled();
    expect(seriesCalls()).toHaveLength(1);
    answer(created);
    expect(await within(panel).findByText(/Repeating booking created/)).toBeInTheDocument();
    expect(seriesCalls()).toHaveLength(1);
  });

  it("needs a day and a sensible end date before sending", async () => {
    const user = userEvent.setup();
    fakeApi(() => Promise.reject(new Error("none")), () => Promise.reject(new Error("must not be called")));
    renderCalendar();
    const panel = await selectTuesdayTen(user);
    await user.click(within(panel).getByLabelText("Repeat weekly"));
    await user.click(within(panel).getByRole("checkbox", { name: "Tue" }));
    await user.click(within(panel).getByRole("button", { name: "Book every week" }));
    expect(within(panel).getByText("Choose at least one day of the week.")).toBeInTheDocument();
    expect(seriesCalls()).toHaveLength(0);
  });

  it("explains INVALID_RRULE in a sentence", async () => {
    const user = userEvent.setup();
    fakeApi(
      () => Promise.reject(new Error("none")),
      () => Promise.reject(new ApiError(422, "INVALID_RRULE", "This rule has no occurrences left: its UNTIL has passed")),
    );
    renderCalendar();
    const panel = await selectTuesdayTen(user);
    await user.click(within(panel).getByLabelText("Repeat weekly"));
    await user.click(within(panel).getByRole("button", { name: "Book every week" }));
    expect(
      await within(panel).findByText(
        "That repeat pattern can't be used: choose at least one weekday and an end date late enough to include another occurrence.",
      ),
    ).toBeInTheDocument();
    expect(within(panel).queryByText(/UNTIL/)).not.toBeInTheDocument();
  });
});

describe("keyboard selection", () => {
  it("opens the panel for the cell the key was pressed on, even before focus state catches up", async () => {
    fakeApi(() => Promise.reject(new Error("no booking expected")));
    renderCalendar();
    const cell = await screen.findByRole("gridcell", { name: /^Thursday 1 October, 14:00 to 14:30/ });
    // Focus and Enter in one tick, with no render in between (as assistive tech can do).
    act(() => {
      cell.focus();
      cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const panel = await screen.findByRole("form", { name: "New booking" });
    expect(within(panel).getByRole("heading")).toHaveTextContent("Thu 1 Oct, 14:00–15:00");
  });
});
