import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, refreshSession } from "../../lib/api";
import MaintenanceTab from "./MaintenanceTab";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiRequest: vi.fn(),
  refreshSession: vi.fn(),
}));

const ist = (local: string) => new Date(`${local}+05:30`).toISOString();
const LAB = { id: "r1", name: "Systems Lab", departmentId: "d1", isActive: true, owners: [] };
const mocked = vi.mocked(apiRequest);
type Init = { method: string; body?: unknown };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(ist("2026-10-05T09:00:00")));
  vi.mocked(refreshSession).mockResolvedValue(true);
  mocked.mockImplementation((path: string, init: Init) => {
    if (path === "/api/auth/me") return Promise.resolve({ id: "u-admin", role: "admin", departmentId: "d1" });
    if (path === "/api/resources") return Promise.resolve([LAB]);
    if (path.startsWith("/api/users")) return Promise.resolve([]);
    if (path.startsWith("/api/maintenance?")) return Promise.resolve([]);
    if (path.includes("/availability")) {
      return Promise.resolve({
        busy: [
          { kind: "booking", start: ist("2026-10-05T10:30:00"), end: ist("2026-10-05T11:30:00"), status: "approved" },
          { kind: "booking", start: ist("2026-10-05T14:00:00"), end: ist("2026-10-05T15:00:00"), status: "pending" },
        ],
      });
    }
    if (path === "/api/maintenance" && init.method === "POST") {
      return Promise.resolve({ id: "m1", ...(init.body as object), cancelledBookingIds: ["b1"] });
    }
    return Promise.reject(new Error(`unexpected ${init.method} ${path}`));
  });
});
afterEach(() => vi.useRealTimers());

const posts = () => mocked.mock.calls.filter(([, init]) => init.method === "POST");

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MaintenanceTab />
    </QueryClientProvider>,
  );
}

describe("maintenance windows", () => {
  it("won't review an incomplete or past window", async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole("option", { name: "Systems Lab" });
    await user.selectOptions(screen.getByLabelText("Resource"), "r1");
    await user.click(await screen.findByRole("button", { name: "Review…" }));
    expect(screen.getByText("Choose when it starts.")).toBeInTheDocument();
    expect(screen.getByText("Give a reason: bookers whose bookings it cancels will see it.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Starts (IST)"), "2026-10-05T06:00");
    await user.type(screen.getByLabelText("Ends (IST)"), "2026-10-05T08:00");
    await user.type(screen.getByLabelText("Reason (bookers see this)"), "Rewiring");
    await user.click(screen.getByRole("button", { name: "Review…" }));
    expect(screen.getByText("It must end in the future.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Confirm maintenance window" })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("says plainly that overlapping bookings will be cancelled, with today's count, before creating", async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole("option", { name: "Systems Lab" });
    await user.selectOptions(screen.getByLabelText("Resource"), "r1");
    await user.type(await screen.findByLabelText("Starts (IST)"), "2026-10-05T10:00");
    await user.type(screen.getByLabelText("Ends (IST)"), "2026-10-05T12:00");
    await user.type(screen.getByLabelText("Reason (bookers see this)"), "Rewiring");
    await user.click(screen.getByRole("button", { name: "Review…" }));

    const confirm = screen.getByRole("group", { name: "Confirm maintenance window" });
    expect(
      await within(confirm).findByText(
        "Every booking on Systems Lab that overlaps Mon 5 Oct, 10:00–12:00 (pending, approved or in progress) will be cancelled automatically, and its booker will see your reason. 1 booking overlaps it right now.",
      ),
    ).toBeInTheDocument();
    expect(posts()).toHaveLength(0);

    // Back keeps the draft; nothing is sent.
    await user.click(within(confirm).getByRole("button", { name: "Back" }));
    expect(posts()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Review…" }));

    await user.click(screen.getByRole("button", { name: "Create window and cancel overlapping bookings" }));
    expect(await screen.findByText("Window created for Mon 5 Oct, 10:00–12:00. 1 booking was cancelled.")).toBeInTheDocument();
    expect(posts()).toEqual([
      [
        "/api/maintenance",
        { method: "POST", body: { resourceId: "r1", start: ist("2026-10-05T10:00:00"), end: ist("2026-10-05T12:00:00"), reason: "Rewiring" } },
      ],
    ]);
  });
});
