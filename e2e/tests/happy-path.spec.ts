import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { accounts, Api } from "./stack.js";

interface Resource {
  id: string;
  name: string;
}
interface Booking {
  id: string;
  status: string;
  start: string;
  end: string;
}

const E2E_RESOURCE = "E2E Lab";
const MIN = 60_000;
const istDate = (d: Date) => new Date(d.getTime() + 330 * MIN).toISOString().slice(0, 10);

/**
 * The happy path, end to end on the running stack: register, sign in through
 * the UI, book a slot, have the resource owner approve it, check in through
 * the resource's signed QR link, and check out through the same link.
 *
 * A fresh student each run keeps runs independent: no leftover bookings of
 * theirs, and their own scan rate-limit budget (5 per resource per minute).
 *
 * The PWA has no booking or approval screens yet (CLAUDE.md §11 screens 2–5
 * aren't built), so those two steps use the real API; everything else is
 * the browser.
 */
test("book, approve, check in and check out", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not configured");
  const who = accounts();
  const admin = await Api.signIn(baseURL, who.admin);
  const owner = await Api.signIn(baseURL, who.owner);
  const run = randomUUID().slice(0, 8);
  const studentLogin = { email: `e2e.${run}@college.edu`, password: randomBytes(12).toString("base64url") };
  const student = await Api.register(baseURL, {
    ...studentLogin,
    fullName: `E2E Student ${run}`,
    departmentId: owner.user.departmentId,
  });

  // A slot starting 2 minutes from now, so check-in (start − 15 min) is already open.
  const start = new Date(Math.ceil(Date.now() / MIN) * MIN + 2 * MIN);
  const end = new Date(start.getTime() + 30 * MIN);
  test.skip(istDate(start) !== istDate(new Date(end.getTime() - 1)), "bookings can't cross IST midnight; run again after 00:00 IST");

  // A dedicated resource that requires approval, owned by the owner account.
  const existing = await admin.call<Resource[]>("GET", `/api/resources?q=${encodeURIComponent(E2E_RESOURCE)}`);
  const resource =
    existing.data.find((r) => r.name === E2E_RESOURCE) ??
    (
      await admin.call<Resource>("POST", "/api/resources", {
        departmentId: owner.user.departmentId,
        name: E2E_RESOURCE,
        type: "lab",
        location: "Automated end-to-end tests",
        capacity: 10,
        requiresApproval: true,
        approvalLevels: 1,
        minSlotMinutes: 30,
        maxSlotMinutes: 120,
        bookingHorizonDays: 7,
        owners: [{ userId: owner.user.id, approvalLevel: 1 }],
      })
    ).data;

  // An interrupted earlier run may have left a booking holding our slot: the
  // owner clears it (cancelling, or ending a session still checked in).
  const held = await owner.call<Booking[]>(
    "GET",
    `/api/bookings?resourceId=${resource.id}&status=pending,approved,checked_in&from=${start.toISOString()}&to=${end.toISOString()}`,
  );
  for (const b of held.data) {
    if (b.status === "checked_in") await owner.call("POST", "/api/checkin/manual", { bookingId: b.id });
    else await owner.call("POST", `/api/bookings/${b.id}/cancel`);
  }

  // 1. Sign in through the UI as the newly registered student.
  await page.goto("/login");
  await page.getByLabel("Email").fill(studentLogin.email);
  await page.locator("#sign-in-password").fill(studentLogin.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/scan$/);

  // 2. Book (API: no booking screen yet). It needs approval.
  const booked = await student.call<Booking>(
    "POST",
    "/api/bookings",
    { resourceId: resource.id, start: start.toISOString(), end: end.toISOString(), purpose: "End-to-end test" },
    { "Idempotency-Key": `e2e-${randomUUID()}` },
  );
  expect(booked.data.status).toBe("pending");

  // 3. The owner approves it (API: no approvals screen yet).
  const approved = await owner.call<Booking>("POST", `/api/bookings/${booked.data.id}/approve`, { comment: "e2e" });
  expect(approved.data.status).toBe("approved");

  // 4. Check in through the signed link the printed QR code opens.
  const link = await owner.checkinPath(resource.id);
  expect(link).toMatch(/^\/checkin\?r=[0-9a-f-]{36}&sig=/);
  await page.goto(link);
  await page.getByRole("button", { name: "Check in or out" }).click();
  await expect(page.getByText("Checked in", { exact: true })).toBeVisible();
  expect((await student.call<Booking>("GET", `/api/bookings/${booked.data.id}`)).data.status).toBe("checked_in");

  // 5. The same link again checks out.
  await page.goto(link);
  await page.getByRole("button", { name: "Check in or out" }).click();
  await expect(page.getByText("Checked out", { exact: true })).toBeVisible();
  expect((await student.call<Booking>("GET", `/api/bookings/${booked.data.id}`)).data.status).toBe("completed");

  await Promise.all([admin.dispose(), owner.dispose(), student.dispose()]);
});
