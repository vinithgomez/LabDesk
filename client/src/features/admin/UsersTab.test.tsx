import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, refreshSession } from "../../lib/api";
import UsersTab from "./UsersTab";
import { roleChangeWarning } from "./users";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiRequest: vi.fn(),
  refreshSession: vi.fn(),
}));

const PEOPLE = [
  { id: "u-admin", fullName: "Admin Person", email: "admin@college.edu", role: "admin", departmentId: "d1", isActive: true },
  { id: "u-priya", fullName: "Priya Nair", email: "priya@college.edu", role: "student", departmentId: "d1", isActive: true },
];
const mocked = vi.mocked(apiRequest);
type Init = { method: string; body?: unknown };
let changeRole: (init: Init) => Promise<unknown>;

beforeEach(() => {
  vi.mocked(refreshSession).mockResolvedValue(true);
  changeRole = (init) => Promise.resolve({ ...PEOPLE[1], ...(init.body as object) });
  mocked.mockImplementation((path: string, init: Init) => {
    if (path === "/api/auth/me") return Promise.resolve({ id: "u-admin", role: "admin", departmentId: "d1" });
    if (path === "/api/departments") return Promise.resolve([{ id: "d1", name: "CSE", code: "CSE" }, { id: "d2", name: "ECE", code: "ECE" }]);
    if (path.startsWith("/api/users?") || path === "/api/users") return Promise.resolve(PEOPLE);
    if (path === "/api/users/u-priya/role") return changeRole(init);
    return Promise.reject(new Error(`unexpected ${init.method} ${path}`));
  });
});

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UsersTab />
    </QueryClientProvider>,
  );
}
const patches = () => mocked.mock.calls.filter(([, init]) => init.method === "PATCH");

describe("users tab", () => {
  it("lists the admin's own department by default and asks for others explicitly", async () => {
    const user = userEvent.setup();
    renderTab();
    expect(await screen.findByText("Priya Nair")).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledWith("/api/users", { method: "GET" });
    await screen.findByRole("option", { name: "ECE" });
    await user.selectOptions(screen.getByLabelText("Department"), "all");
    expect(mocked).toHaveBeenCalledWith("/api/users?departmentId=all", { method: "GET" });
  });

  it("changes a role only after a confirm that says what the role allows", async () => {
    const user = userEvent.setup();
    renderTab();
    const row = (await screen.findByText("Priya Nair")).closest("tr") as HTMLElement;
    await user.selectOptions(within(row).getByLabelText("Role for Priya Nair"), "faculty");
    await user.click(within(row).getByRole("button", { name: "Change…" }));
    expect(patches()).toHaveLength(0);

    const confirm = screen.getByRole("dialog", { name: "Change Priya Nair's role?" });
    expect(confirm).toHaveTextContent(roleChangeWarning({ fullName: "Priya Nair", role: "student" }, "faculty"));
    await user.click(within(confirm).getByRole("button", { name: "Make faculty" }));
    expect(await screen.findByText("Priya Nair is now faculty.")).toBeInTheDocument();
    expect(patches()).toEqual([["/api/users/u-priya/role", { method: "PATCH", body: { role: "faculty" } }]]);
  });

  it("offers no role control on your own row", async () => {
    renderTab();
    const row = (await screen.findByText("Admin Person")).closest("tr") as HTMLElement;
    expect(within(row).getByText("(you can't change your own role)")).toBeInTheDocument();
    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("explains a refused change", async () => {
    const user = userEvent.setup();
    changeRole = () => Promise.reject(new ApiError(404, "USER_NOT_FOUND", "User not found"));
    renderTab();
    const row = (await screen.findByText("Priya Nair")).closest("tr") as HTMLElement;
    await user.selectOptions(within(row).getByLabelText("Role for Priya Nair"), "admin");
    await user.click(within(row).getByRole("button", { name: "Change…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Make admin" }));
    expect(await within(screen.getByRole("dialog")).findByText("That user doesn't exist.")).toBeInTheDocument();
  });
});

describe("roleChangeWarning", () => {
  it("says what the new role allows, and what a demoted owner loses", () => {
    expect(roleChangeWarning({ fullName: "Priya Nair", role: "student" }, "admin")).toBe(
      "Change Priya Nair from Student to Admin? As admin, they can manage every resource, owner, maintenance window and user, in any department.",
    );
    expect(roleChangeWarning({ fullName: "Dr. Rao", role: "faculty" }, "student")).toMatch(/lose the power to approve\.$/);
  });
});
