import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "../../lib/api";
import type { Resource } from "../resources/use-resources";
import { ResourceForm } from "./ResourceForm";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiRequest: vi.fn(),
}));

const DEPARTMENTS = [{ id: "d1", name: "Computer Science", code: "CSE" }];
const STAFF = [
  { id: "u-anita", fullName: "Dr. Anita Rao", email: "anita@college.edu", role: "faculty", departmentId: "d1", isActive: true },
  { id: "u-kumar", fullName: "Dr. Kumar", email: "kumar@college.edu", role: "lab_incharge", departmentId: "d1", isActive: true },
  { id: "u-priya", fullName: "Priya Nair", email: "priya@college.edu", role: "student", departmentId: "d1", isActive: true },
];
const mocked = vi.mocked(apiRequest);
type Init = { method: string; body?: unknown };

function fakeApi(onWrite: (path: string, init: Init) => Promise<unknown>) {
  mocked.mockImplementation((path: string, init: Init) => {
    if (path.startsWith("/api/users")) {
      const q = new URL(path, "http://x").searchParams.get("q")?.toLowerCase();
      return Promise.resolve(q ? STAFF.filter((u) => u.fullName.toLowerCase().includes(q)) : STAFF);
    }
    if (init.method === "GET") return Promise.reject(new Error(`unexpected GET ${path}`));
    return onWrite(path, init);
  });
}
const writes = () => mocked.mock.calls.filter(([, init]) => init.method !== "GET");

function renderForm(original: Resource | null = null, onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ResourceForm original={original} departments={DEPARTMENTS} defaultDepartmentId="d1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Systems Lab");
  await user.type(screen.getByLabelText("Location"), "Block A");
}

describe("ResourceForm validation", () => {
  it("shows every problem at once and sends nothing", async () => {
    const user = userEvent.setup();
    fakeApi(() => Promise.reject(new Error("must not be called")));
    renderForm();
    await user.clear(screen.getByLabelText("Capacity (people)"));
    await user.type(screen.getByLabelText("Capacity (people)"), "-3");
    await user.clear(screen.getByLabelText("Shortest booking (min)"));
    await user.type(screen.getByLabelText("Shortest booking (min)"), "240");
    await user.click(screen.getByRole("button", { name: "Create resource" }));

    expect(screen.getByText("Give it a name.")).toBeInTheDocument();
    expect(screen.getByText("Say where it is.")).toBeInTheDocument();
    expect(screen.getByText("A whole number from 0 (no limit) to 10,000.")).toBeInTheDocument();
    expect(screen.getByText("The shortest booking can't be longer than the longest.")).toBeInTheDocument();
    expect(screen.getByText("Fix the highlighted fields first.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Give it a name.");
    expect(writes()).toHaveLength(0);
  });

  it("catches business hours that close before they open", async () => {
    const user = userEvent.setup();
    fakeApi(() => Promise.reject(new Error("must not be called")));
    renderForm();
    await fillBasics(user);
    await user.clear(screen.getByLabelText("Opens (IST)"));
    await user.type(screen.getByLabelText("Opens (IST)"), "19:00");
    await user.click(screen.getByRole("button", { name: "Create resource" }));
    expect(screen.getByText("The closing time must be later than the opening time.")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("needs an owner before approval can be required, then sends the owner with its level", async () => {
    const user = userEvent.setup();
    fakeApi((path, init) => Promise.resolve({ id: "r-new", name: "Systems Lab", path, init }));
    const onClose = renderForm();
    await fillBasics(user);
    await user.click(screen.getByLabelText("Bookings need approval"));
    await user.click(screen.getByRole("button", { name: "Create resource" }));
    expect(screen.getByText("Bookings here need approval, so add an owner at level 1.")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    // Students are listed but can't be picked.
    await user.type(screen.getByLabelText("Add an owner"), "priya");
    const student = await screen.findByRole("button", { name: /Priya Nair/ });
    expect(student).toBeDisabled();
    expect(student).toHaveTextContent("Students can't own resources");

    await user.clear(screen.getByLabelText("Add an owner"));
    await user.type(screen.getByLabelText("Add an owner"), "anita");
    await user.click(await screen.findByRole("button", { name: /Dr\. Anita Rao/ }));
    await user.click(screen.getByRole("button", { name: "Create resource" }));

    expect(writes()).toHaveLength(1);
    const [path, init] = writes()[0] as [string, Init];
    expect(path).toBe("/api/resources");
    expect(init.body).toMatchObject({
      departmentId: "d1",
      name: "Systems Lab",
      location: "Block A",
      requiresApproval: true,
      approvalLevels: 1,
      owners: [{ userId: "u-anita", approvalLevel: 1 }],
    });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ id: "r-new" })));
  });

  it("shows the server's refusal in plain words", async () => {
    const user = userEvent.setup();
    fakeApi(() =>
      Promise.reject(new ApiError(422, "OWNER_REQUIRED", "A resource that requires approval needs at least one owner", { missingLevels: [2] })),
    );
    renderForm();
    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Create resource" }));
    expect(
      await screen.findByText("Bookings here need approval, so add an owner at level 2: every approval level in use needs at least one owner."),
    ).toBeInTheDocument();
  });

  it("changes the number of approval levels and the owners for it in one request, approval staying on", async () => {
    const user = userEvent.setup();
    fakeApi((path, init) => Promise.resolve({ id: "r1", name: "GPU Box", path, init }));
    const original: Resource = {
      id: "r1",
      departmentId: "d1",
      name: "GPU Box",
      type: "equipment",
      location: "Room 214",
      capacity: 1,
      description: "",
      requiresApproval: true,
      approvalLevels: 1,
      minSlotMinutes: 30,
      maxSlotMinutes: 180,
      bookingHorizonDays: 14,
      businessHoursStart: "08:00",
      businessHoursEnd: "18:00",
      businessDays: [1, 2, 3, 4, 5],
      isActive: true,
      ownerIds: ["u-anita"],
      owners: [{ userId: "u-anita", approvalLevel: 1 }],
    };
    renderForm(original);
    await user.selectOptions(screen.getByLabelText("Approval levels"), "2");
    await user.type(screen.getByLabelText("Add an owner"), "kumar");
    await user.click(await screen.findByRole("button", { name: /Dr\. Kumar/ }));
    await user.selectOptions(screen.getByLabelText("Approval level for Dr. Kumar"), "2");
    const owners = screen.getByRole("group", { name: "Owners (they approve and manage it)" });
    expect(within(owners).getByText(/Dr\. Anita Rao/)).toBeInTheDocument();

    // One PATCH carries the new level count and the owners for it; the server
    // validates them together. Approval is never switched off.
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual([
      "/api/resources/r1",
      {
        method: "PATCH",
        body: {
          approvalLevels: 2,
          owners: [
            { userId: "u-anita", approvalLevel: 1 },
            { userId: "u-kumar", approvalLevel: 2 },
          ],
        },
      },
    ]);
    expect(screen.queryByText(/can't be saved/)).not.toBeInTheDocument();
  });

  it("still names the missing level if the server refuses with OWNER_REQUIRED", async () => {
    const user = userEvent.setup();
    fakeApi(() =>
      Promise.reject(new ApiError(422, "OWNER_REQUIRED", "missing", { missingLevels: [2] })),
    );
    renderForm({
      id: "r1",
      departmentId: "d1",
      name: "GPU Box",
      type: "equipment",
      location: "Room 214",
      capacity: 1,
      description: "",
      requiresApproval: true,
      approvalLevels: 1,
      minSlotMinutes: 30,
      maxSlotMinutes: 180,
      bookingHorizonDays: 14,
      businessHoursStart: "08:00",
      businessHoursEnd: "18:00",
      businessDays: [1, 2, 3, 4, 5],
      isActive: true,
      ownerIds: ["u-anita"],
      owners: [{ userId: "u-anita", approvalLevel: 1 }],
    });
    await user.clear(screen.getByLabelText("Capacity (people)"));
    await user.type(screen.getByLabelText("Capacity (people)"), "2");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Bookings here need approval, so add an owner at level 2: every approval level in use needs at least one owner."),
    ).toBeInTheDocument();
  });
});
