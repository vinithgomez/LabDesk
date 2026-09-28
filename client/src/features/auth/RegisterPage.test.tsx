import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, refreshSession, register } from "../../lib/api";
import RegisterPage from "./RegisterPage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiRequest: vi.fn(),
  refreshSession: vi.fn(),
  register: vi.fn(),
}));

const DEPARTMENTS = [
  { id: "d-cse", name: "Computer Science & Engineering", code: "CSE" },
  { id: "d-ece", name: "Electronics & Communication Engineering", code: "ECE" },
];

function renderRegister() {
  vi.mocked(refreshSession).mockResolvedValue(false);
  vi.mocked(apiRequest).mockImplementation((path: string) =>
    path === "/api/departments" ? Promise.resolve(DEPARTMENTS) : Promise.reject(new Error(path)),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/register?next=%2Fresources%2Fr1"]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/resources/:id" element={<p>Calendar for r1</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Full name"), "Priya Nair");
  await user.type(screen.getByLabelText("College email"), "priya@college.edu");
  await user.type(screen.getByLabelText(/^Password/), "long-enough-1");
  await screen.findByRole("option", { name: "Electronics & Communication Engineering (ECE)" });
  // By value: user-event compares option text as HTML, where "&" is "&amp;".
  await user.selectOptions(screen.getByLabelText("Department"), "d-ece");
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

// The session is module-level, so these run in order: refused first, then accepted.
describe("RegisterPage", () => {
  it("explains a refused registration in a sentence", async () => {
    const user = userEvent.setup();
    vi.mocked(register).mockRejectedValue(new ApiError(409, "EMAIL_TAKEN", "Email already registered"));
    renderRegister();
    await fillForm(user);
    expect(await screen.findByText("An account with that email already exists; sign in instead.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fresources%2Fr1");
  });

  it("creates a student account in the chosen department, then goes where the user was headed", async () => {
    const user = userEvent.setup();
    vi.mocked(register).mockResolvedValue(undefined);
    renderRegister();
    await fillForm(user);
    expect(await screen.findByText("Calendar for r1")).toBeInTheDocument();
    // No role is sent: every new account is a student (§2b).
    expect(register).toHaveBeenCalledWith({
      fullName: "Priya Nair",
      email: "priya@college.edu",
      password: "long-enough-1",
      departmentId: "d-ece",
    });
  });
});
