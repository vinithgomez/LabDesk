import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { accounts, Api } from "./stack.js";

interface Resource {
  id: string;
  name: string;
  bookingHorizonDays: number;
}
interface Booking {
  id: string;
  status: string;
  start: string;
  end: string;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const IST_OFFSET = 330 * MIN;
/** The IST calendar date of an instant, "yyyy-MM-dd". */
const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET).toISOString().slice(0, 10);
/** The instant of an IST wall-clock time on an IST date. */
const istInstant = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

/** Booked through the calendar, tomorrow at a fixed hour: needs approval, owned by the owner account. */
const BOOKING_LAB = {
  name: "E2E Lab",
  type: "lab",
  location: "Automated end-to-end tests",
  capacity: 10,
  requiresApproval: true,
  approvalLevels: 1,
  // Pinned every run, so an older version of this test can't leave it different.
  settings: { minSlotMinutes: 30, maxSlotMinutes: 120, bookingHorizonDays: 7, businessHoursStart: "08:00", businessHoursEnd: "18:00" },
};
const TOMORROW_START = "10:00";
const TOMORROW_END = "11:00";

/**
 * For checking in: bookings here are approved on creation, and a short
 * minimum lets a booking that starts now fit before IST midnight whenever
 * the test runs.
 */
const CHECKIN_LAB = {
  name: "E2E Check-in Lab",
  type: "lab",
  location: "Automated end-to-end tests",
  capacity: 10,
  requiresApproval: false,
  approvalLevels: 1,
  settings: { minSlotMinutes: 1, maxSlotMinutes: 60, bookingHorizonDays: 2 },
};

async function signInThroughUi(page: Page, login: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(login.email);
  await page.locator("#sign-in-password").fill(login.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/resources$/);
}

/** The fixture resource, created on first use and re-pinned to its settings every run. */
async function fixtureResource(admin: Api, owner: Api, spec: typeof BOOKING_LAB | typeof CHECKIN_LAB): Promise<Resource> {
  const existing = await admin.call<Resource[]>("GET", `/api/resources?q=${encodeURIComponent(spec.name)}`);
  const found = existing.data.find((r) => r.name === spec.name);
  const { settings, ...fields } = spec;
  if (!found) {
    return (
      await admin.call<Resource>("POST", "/api/resources", {
        departmentId: owner.user.departmentId,
        ...fields,
        ...settings,
        owners: [{ userId: owner.user.id, approvalLevel: 1 }],
      })
    ).data;
  }
  return (await admin.call<Resource>("PATCH", `/api/resources/${found.id}`, settings)).data;
}

/** A leftover from an interrupted run may hold the slot: clear it (cancel, or end a session still checked in). */
async function clearHolds(owner: Api, resourceId: string, from: Date, to: Date) {
  const held = await owner.call<Booking[]>(
    "GET",
    `/api/bookings?resourceId=${resourceId}&status=pending,approved,checked_in&from=${from.toISOString()}&to=${to.toISOString()}`,
  );
  for (const b of held.data) {
    if (b.status === "checked_in") await owner.call("POST", "/api/checkin/manual", { bookingId: b.id });
    else await owner.call("POST", `/api/bookings/${b.id}/cancel`);
  }
}

/** A fresh student per test: no leftover bookings, and their own scan rate-limit budget. */
async function freshStudent(baseURL: string, departmentId: string) {
  const run = randomUUID().slice(0, 8);
  const login = { email: `e2e.${run}@college.edu`, password: randomBytes(12).toString("base64url") };
  const name = `E2E Student ${run}`;
  const api = await Api.register(baseURL, { ...login, fullName: name, departmentId });
  return { login, name, api };
}

/**
 * Booking and approval, all through the UI: a fresh student books tomorrow
 * 10:00–11:00 IST by dragging on the week calendar, and the resource's owner
 * approves it in the approvals inbox in a second browser. Tomorrow at a fixed
 * hour means the same steps run whatever the time of day.
 */
test("book on the calendar, approve in the inbox", async ({ page, browser, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not configured");
  const who = accounts();
  const admin = await Api.signIn(baseURL, who.admin);
  const owner = await Api.signIn(baseURL, who.owner);
  const lab = await fixtureResource(admin, owner, BOOKING_LAB);

  const tomorrow = istDate(new Date(Date.now() + DAY));
  const start = istInstant(tomorrow, TOMORROW_START);
  const end = istInstant(tomorrow, TOMORROW_END);
  // The horizon allows it: tomorrow's slot ends well within 7 days of now.
  expect(lab.bookingHorizonDays).toBeGreaterThanOrEqual(2);
  expect(end.getTime()).toBeLessThan(Date.now() + lab.bookingHorizonDays * DAY);
  await clearHolds(owner, lab.id, start, end);

  const student = await freshStudent(baseURL, owner.user.departmentId);
  await signInThroughUi(page, student.login);
  await page.getByRole("link", { name: BOOKING_LAB.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/resources/${lab.id}$`));
  await expect(page.locator("[role=gridcell]").first()).toBeVisible();
  // The grid shows Monday to Sunday: from a Sunday, tomorrow is on next week's page.
  if ((await page.locator(`[role=gridcell][data-day="${tomorrow}"]`).count()) === 0) {
    await page.getByRole("button", { name: "Next week" }).click();
  }

  // Drag 10:00 → 10:30 (two half-hour rows: 10:00–11:00).
  const from = page.locator(`[role=gridcell][data-day="${tomorrow}"][data-time="10:00"]`);
  const to = page.locator(`[role=gridcell][data-day="${tomorrow}"][data-time="10:30"]`);
  await expect(from).toHaveAttribute("aria-disabled", "false");
  await from.hover();
  await page.mouse.down();
  await to.hover();
  await page.mouse.up();

  const panel = page.getByRole("form", { name: "New booking" });
  await expect(panel.getByRole("heading")).toHaveText(/, 10:00–11:00$/);
  await panel.getByLabel("Purpose").fill("End-to-end test");
  await panel.getByRole("button", { name: "Book", exact: true }).click();
  await expect(panel.getByText("Booked; waiting for approval.")).toBeVisible();
  // The result is announced to screen readers too.
  await expect(page.getByRole("status").filter({ hasText: /^Booked / })).toHaveText(/Waiting for approval\.$/);

  const mine = await student.api.call<Booking[]>("GET", `/api/bookings?mine=true&resourceId=${lab.id}&status=pending`);
  expect(mine.data).toHaveLength(1);
  const booking = mine.data[0] as Booking;
  expect(new Date(booking.start)).toEqual(start);
  expect(new Date(booking.end)).toEqual(end);

  // The owner approves it in the approvals inbox, in their own browser.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInThroughUi(ownerPage, who.owner);
  await ownerPage.getByRole("link", { name: "Approvals" }).click();
  await expect(ownerPage).toHaveURL(/\/approvals$/);
  const item = ownerPage.getByRole("listitem").filter({ hasText: student.name });
  await expect(item).toHaveCount(1);
  await expect(item.getByRole("heading", { name: BOOKING_LAB.name })).toBeVisible();
  await expect(item).toContainText("End-to-end test");
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(ownerPage.getByRole("status")).toHaveText(new RegExp(`^Approved: ${BOOKING_LAB.name}, .* for ${student.name}\\.$`));
  await expect(item).toHaveCount(0);
  await ownerContext.close();
  expect((await student.api.call<Booking>("GET", `/api/bookings/${booking.id}`)).data.status).toBe("approved");

  await Promise.all([admin.dispose(), owner.dispose(), student.api.dispose()]);
});

/**
 * Check-in and check-out through the resource's signed QR link. Check-in
 * opens 15 minutes before a booking's start on the real clock, so this
 * booking (made through the API, as a fixture) starts at the next whole
 * minute; it ends 30 minutes later or at IST midnight, whichever comes
 * first, so it is always a valid same-day booking.
 */
test("check in and out through the QR link", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not configured");
  const who = accounts();
  const admin = await Api.signIn(baseURL, who.admin);
  const owner = await Api.signIn(baseURL, who.owner);
  const lab = await fixtureResource(admin, owner, CHECKIN_LAB);

  const start = new Date(Math.floor(Date.now() / MIN) * MIN + MIN);
  const nextIstMidnight = istInstant(istDate(new Date(start.getTime() + DAY)), "00:00");
  const end = new Date(Math.min(start.getTime() + 30 * MIN, nextIstMidnight.getTime()));
  await clearHolds(owner, lab.id, start, end);

  const student = await freshStudent(baseURL, owner.user.departmentId);
  const booked = await student.api.call<Booking>(
    "POST",
    "/api/bookings",
    { resourceId: lab.id, start: start.toISOString(), end: end.toISOString(), purpose: "End-to-end check-in" },
    { "Idempotency-Key": `e2e-${randomUUID()}` },
  );
  expect(booked.data.status).toBe("approved"); // no approval needed on this resource

  await signInThroughUi(page, student.login);
  const link = await owner.checkinPath(lab.id);
  expect(link).toMatch(/^\/checkin\?r=[0-9a-f-]{36}&sig=/);

  await page.goto(link);
  await page.getByRole("button", { name: "Check in or out" }).click();
  await expect(page.getByText("Checked in", { exact: true })).toBeVisible();
  expect((await student.api.call<Booking>("GET", `/api/bookings/${booked.data.id}`)).data.status).toBe("checked_in");

  // The same link again checks out.
  await page.goto(link);
  await page.getByRole("button", { name: "Check in or out" }).click();
  await expect(page.getByText("Checked out", { exact: true })).toBeVisible();
  expect((await student.api.call<Booking>("GET", `/api/bookings/${booked.data.id}`)).data.status).toBe("completed");

  await Promise.all([admin.dispose(), owner.dispose(), student.api.dispose()]);
});
