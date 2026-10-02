import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, refreshSession } from "../../lib/api";
import ApprovalsPage from "./ApprovalsPage";
import type { InboxItem } from "./model";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiRequest: vi.fn(),
  refreshSession: vi.fn(),
}));

const ME = { id: "u-faculty", fullName: "Dr. Anita Rao", role: "faculty", departmentId: "d1", department: { id: "d1", name: "CSE", code: "CSE" } };
const ist = (local: string) => new Date(`${local}+05:30`).toISOString();

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "b1",
  resourceId: "r1",
  userId: "u-booker",
  start: ist("2026-10-05T10:00:00"),
  end: ist("2026-10-05T11:00:00"),
  status: "pending",
  purpose: "Networks practical",
  attendeeCount: 12,
  seriesId: null,
  cancelledByMaintenanceId: null,
  createdAt: "",
  updatedAt: "",
  approvals: [],
  awaitingLevel: 1,
  booker: { id: "u-booker", fullName: "Priya Nair" },
  resource: { id: "r1", name: "Systems Lab" },
  awaitingSince: "",
  stalled: false,
  lapsed: false,
  canDecide: true,
  ...over,
});

type Init = { method: string; body?: unknown };
const mocked = vi.mocked(apiRequest);

/** A fake API. `inbox` is what GET /api/bookings/pending returns now; `decide` answers approve/reject. */
function fakeApi(state: { inbox: InboxItem[] }, decide: (path: string, init: Init) => Promise<unknown>) {
  vi.mocked(refreshSession).mockResolvedValue(true);
  mocked.mockImplementation((path: string, init: Init) => {
    if (path === "/api/auth/me") return Promise.resolve(ME);
    if (path.startsWith("/api/bookings/pending")) return Promise.resolve(state.inbox);
    if (/^\/api\/bookings\/[^/]+\/(approve|reject)$/.test(path)) return decide(path, init);
    return Promise.reject(new Error(`unexpected ${init.method} ${path}`));
  });
}

const inboxGets = () => mocked.mock.calls.filter(([path]) => path.startsWith("/api/bookings/pending")).length;
const decisions = () => mocked.mock.calls.filter(([path]) => /\/(approve|reject)$/.test(path));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ApprovalsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const row = async (resource = "Systems Lab") => {
  const heading = await screen.findByRole("heading", { name: resource });
  return heading.closest("li") as HTMLElement;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(ist("2026-10-05T09:00:00")));
});
afterEach(() => vi.useRealTimers());

describe("approvals inbox", () => {
  it("shows who, what, when, how many, which level, and the trail so far", async () => {
    fakeApi(
      {
        inbox: [
          item({
            awaitingLevel: 2,
            approvals: [
              { level: 1, approverId: "u-x", approverName: "Dr. Kumar", decision: "approved", comment: "Fine by me", decidedAt: ist("2026-10-02T15:20:00") },
            ],
          }),
        ],
      },
      () => Promise.reject(new Error("no decision expected")),
    );
    renderPage();
    const r = await row();
    expect(within(r).getByText("Mon 5 Oct, 10:00–11:00")).toBeInTheDocument();
    expect(within(r).getByText("Priya Nair")).toBeInTheDocument();
    expect(r).toHaveTextContent("12 people · awaiting level 2");
    expect(r).toHaveTextContent("Networks practical");
    expect(within(r).getByRole("list", { name: "Approval trail" })).toHaveTextContent(
      "Level 1 approved by Dr. Kumar, Fri 2 Oct, 15:20: “Fine by me”",
    );
    // Only what this approver can decide, unless they ask for everything.
    expect(mocked).toHaveBeenCalledWith("/api/bookings/pending?limit=200&actionable=true", { method: "GET" });
  });

  it("approves in place: the item leaves the list without a reload, and the result is announced", async () => {
    const user = userEvent.setup();
    const state = { inbox: [item(), item({ id: "b2", resource: { id: "r2", name: "GPU Box" } })] };
    fakeApi(state, () => Promise.resolve({ ...item(), status: "approved", awaitingLevel: null }));
    renderPage();
    const r = await row();
    const getsBefore = inboxGets();

    await user.click(within(r).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Systems Lab" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "GPU Box" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Approved: Systems Lab, Mon 5 Oct, 10:00–11:00, for Priya Nair.");
    expect(decisions()).toEqual([["/api/bookings/b1/approve", { method: "POST", body: { comment: "" } }]]);
    // Removed from the cache, not by refetching (the fake API still lists it).
    expect(inboxGets()).toBe(getsBefore);
  });

  it("asks for a reason before rejecting, and sends it", async () => {
    const user = userEvent.setup();
    fakeApi({ inbox: [item()] }, () => Promise.resolve({ ...item(), status: "rejected", awaitingLevel: null }));
    renderPage();
    const r = await row();

    await user.click(within(r).getByRole("button", { name: "Reject…" }));
    await user.click(within(r).getByRole("button", { name: "Reject booking" }));
    expect(within(r).getByText("Say why you're rejecting it; the booker sees this comment.")).toBeInTheDocument();
    expect(decisions()).toHaveLength(0);

    await user.type(within(r).getByLabelText(/Reason for rejecting/), "Clashes with the exam timetable");
    await user.click(within(r).getByRole("button", { name: "Reject booking" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Systems Lab" })).not.toBeInTheDocument());
    expect(decisions()).toEqual([
      ["/api/bookings/b1/reject", { method: "POST", body: { comment: "Clashes with the exam timetable" } }],
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("Rejected: Systems Lab");
  });

  it("explains losing a race (409) and refetches so the list shows the truth", async () => {
    const user = userEvent.setup();
    const state = { inbox: [item()] };
    fakeApi(state, () => {
      state.inbox = []; // another approver decided it first
      return Promise.reject(new ApiError(409, "INVALID_TRANSITION", "This booking's approval state changed while you were deciding"));
    });
    renderPage();
    const r = await row();
    const getsBefore = inboxGets();

    await user.click(within(r).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Not approved. This booking was already decided by someone else, or cancelled, before your decision arrived.")).toBeInTheDocument();
    await waitFor(() => expect(inboxGets()).toBeGreaterThan(getsBefore));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Systems Lab" })).not.toBeInTheDocument());
    expect(screen.getByText("Nothing waiting for your decision.")).toBeInTheDocument();
  });

  it("explains a 403 from a level that moved on, in the approval's terms", async () => {
    const user = userEvent.setup();
    const state = { inbox: [item({ awaitingLevel: 2 })] };
    fakeApi(state, () => {
      state.inbox = [];
      return Promise.reject(new ApiError(403, "FORBIDDEN", "This booking is awaiting level 2 approval"));
    });
    renderPage();
    await user.click(within(await row()).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Not approved. This booking is awaiting level 2 approval, which isn't yours to decide.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Systems Lab" })).not.toBeInTheDocument());
  });

  it("says approval closed when the start passed after the list loaded", async () => {
    const user = userEvent.setup();
    fakeApi({ inbox: [item()] }, () => Promise.reject(new ApiError(409, "INVALID_TRANSITION", "already started")));
    renderPage();
    const r = await row();
    vi.setSystemTime(new Date(ist("2026-10-05T10:05:00"))); // the start passes while it's on screen
    await user.click(within(r).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/Approval is closed: the booking's start time has passed/)).toBeInTheDocument();
  });

  it("marks stalled and lapsed items distinctly, and offers only Reject on a lapsed one", async () => {
    fakeApi(
      {
        inbox: [
          item({ stalled: true, awaitingLevel: 2 }),
          item({ id: "b2", lapsed: true, resource: { id: "r2", name: "GPU Box" }, start: ist("2026-10-05T08:00:00"), end: ist("2026-10-05T08:30:00") }),
        ],
      },
      () => Promise.reject(new Error("no decision expected")),
    );
    renderPage();
    const stalled = await row("Systems Lab");
    expect(within(stalled).getByText("Stalled: level 2 silent 24 h+")).toBeInTheDocument();
    expect(within(stalled).queryByText("Start time passed")).not.toBeInTheDocument();
    expect(within(stalled).getByRole("button", { name: "Approve" })).toBeInTheDocument();

    const lapsed = await row("GPU Box");
    expect(within(lapsed).getByText("Start time passed")).toBeInTheDocument();
    expect(within(lapsed).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(lapsed).getByRole("button", { name: "Reject…" })).toBeInTheDocument();
    expect(within(lapsed).getByText("Its start has passed, so it can only be rejected.")).toBeInTheDocument();
  });

  it("shows items the caller can't decide, with the reason and no buttons, when asked", async () => {
    const user = userEvent.setup();
    fakeApi({ inbox: [item({ canDecide: false, awaitingLevel: 2 })] }, () => Promise.reject(new Error("none")));
    renderPage();
    await user.click(await screen.findByLabelText("Also show pending bookings I can't decide"));
    expect(mocked).toHaveBeenCalledWith("/api/bookings/pending?limit=200", { method: "GET" });
    const r = await row();
    expect(within(r).getByText("Awaiting level 2, which isn't yours to decide.")).toBeInTheDocument();
    expect(within(r).queryByRole("button")).not.toBeInTheDocument();
  });
});
