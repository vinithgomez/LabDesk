import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
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
const DAY = 24 * 60 * MIN;
const ist = (d: Date) => new Date(d.getTime() + 330 * MIN);
const istDate = (d: Date) => ist(d).toISOString().slice(0, 10);
/**
 * Open all day, every day, so the calendar always has a bookable slot at
 * "now"; and a one-minute minimum, so even the last few minutes of the day
 * can be booked.
 */
const ALWAYS_OPEN = {
  businessHoursStart: "00:00",
  businessHoursEnd: "23:59",
  businessDays: [0, 1, 2, 3, 4, 5, 6],
  minSlotMinutes: 1,
};

async function signInThroughUi(page: Page, login: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(login.email);
  await page.locator("#sign-in-password").fill(login.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/resources$/);
}

/**
 * The happy path, end to end on the running stack: register, sign in through
 * the UI, book the slot starting now by dragging on the week calendar, have
 * the resource owner approve it in the approvals inbox, check in through the
 * resource's signed QR link, and check out through the same link. No step
 * goes around the UI except creating the fixtures.
 *
 * A fresh student each run keeps runs independent: no leftover bookings of
 * theirs, and their own scan rate-limit budget (5 per resource per minute).
 */
test("book, approve, check in and check out", async ({ page, browser, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not configured");
  const who = accounts();
  const admin = await Api.signIn(baseURL, who.admin);
  const owner = await Api.signIn(baseURL, who.owner);
  const run = randomUUID().slice(0, 8);
  const studentName = `E2E Student ${run}`;
  const studentLogin = { email: `e2e.${run}@college.edu`, password: randomBytes(12).toString("base64url") };
  const student = await Api.register(baseURL, { ...studentLogin, fullName: studentName, departmentId: owner.user.departmentId });

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
        maxSlotMinutes: 120,
        bookingHorizonDays: 7,
        ...ALWAYS_OPEN,
        owners: [{ userId: owner.user.id, approvalLevel: 1 }],
      })
    ).data;
  // One created by an earlier version of this test has other hours or a longer minimum.
  await admin.call("PATCH", `/api/resources/${resource.id}`, ALWAYS_OPEN);

  // An interrupted earlier run may have left a booking holding our slot: the
  // owner clears it (cancelling, or ending a session still checked in).
  const now = new Date();
  const held = await owner.call<Booking[]>(
    "GET",
    `/api/bookings?resourceId=${resource.id}&status=pending,approved,checked_in&from=${now.toISOString()}&to=${new Date(now.getTime() + 90 * MIN).toISOString()}`,
  );
  for (const b of held.data) {
    if (b.status === "checked_in") await owner.call("POST", "/api/checkin/manual", { bookingId: b.id });
    else await owner.call("POST", `/api/bookings/${b.id}/cancel`);
  }

  // 1. Sign in through the UI as the newly registered student.
  await signInThroughUi(page, studentLogin);

  // 2. Book through the week calendar: open the resource from the directory,
  // then drag from the first free half-hour today (the one under way) down to
  // the next. In the last minute before IST midnight nothing is left today,
  // so it books the first half-hour of tomorrow instead, which starts within
  // a minute, so check-in is still open. It needs approval.
  await page.getByRole("link", { name: E2E_RESOURCE, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/resources/${resource.id}$`));
  await expect(page.locator("[role=gridcell]").first()).toBeVisible();
  const freeOn = (day: string) => page.locator(`[role=gridcell][data-day="${day}"][aria-disabled="false"]`);
  let free = freeOn(istDate(new Date()));
  if ((await free.count()) === 0) {
    const tomorrow = istDate(new Date(Date.now() + DAY));
    // Sunday's tomorrow is on next week's page.
    if (ist(new Date()).getUTCDay() === 0) await page.getByRole("button", { name: "Next week" }).click();
    free = freeOn(tomorrow);
  }
  await expect(free.first()).toBeVisible();
  const last = (await free.count()) > 1 ? free.nth(1) : free.first();
  await free.first().hover();
  await page.mouse.down();
  await last.hover();
  await page.mouse.up();

  const panel = page.getByRole("form", { name: "New booking" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Purpose").fill("End-to-end test");
  await panel.getByRole("button", { name: "Book", exact: true }).click();
  await expect(panel.getByText("Booked; waiting for approval.")).toBeVisible();
  // The result is announced to screen readers too.
  await expect(page.getByRole("status").filter({ hasText: /^Booked / })).toHaveText(/Waiting for approval\.$/);

  const mine = await student.call<Booking[]>("GET", `/api/bookings?mine=true&resourceId=${resource.id}&status=pending`);
  expect(mine.data).toHaveLength(1);
  const booking = mine.data[0] as Booking;
  expect(new Date(booking.start).getTime() - Date.now()).toBeLessThan(2 * MIN);

  // 3. The owner approves it in the approvals inbox, in their own browser.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInThroughUi(ownerPage, who.owner);
  await ownerPage.getByRole("link", { name: "Approvals" }).click();
  await expect(ownerPage).toHaveURL(/\/approvals$/);
  const item = ownerPage.getByRole("listitem").filter({ hasText: studentName });
  await expect(item).toHaveCount(1);
  await expect(item.getByRole("heading", { name: E2E_RESOURCE })).toBeVisible();
  await expect(item).toContainText("End-to-end test");
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(ownerPage.getByRole("status")).toHaveText(new RegExp(`^Approved: ${E2E_RESOURCE}, .* for ${studentName}\\.$`));
  await expect(item).toHaveCount(0);
  await ownerContext.close();
  expect((await student.call<Booking>("GET", `/api/bookings/${booking.id}`)).data.status).toBe("approved");

  // 4. Check in through the signed link the printed QR code opens.
  const link = await owner.checkinPath(resource.id);
  expect(link).toMatch(/^\/checkin\?r=[0-9a-f-]{36}&sig=/);
  await page.goto(link);
  await page.getByRole("button", { name: "Check in or out" }).click();
  await expect(page.getByText("Checked in", { exact: true })).toBeVisible();
  expect((await student.call<Booking>("GET", `/api/bookings/${booking.id}`)).data.status).toBe("checked_in");

  // 5. The same link again checks out.
  await page.goto(link);
  await page.getByRole("button", { name: "Check in or out" }).click();
  await expect(page.getByText("Checked out", { exact: true })).toBeVisible();
  expect((await student.call<Booking>("GET", `/api/bookings/${booking.id}`)).data.status).toBe("completed");

  await Promise.all([admin.dispose(), owner.dispose(), student.dispose()]);
});
