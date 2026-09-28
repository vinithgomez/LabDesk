import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDepartment,
  createHarness,
  createResource,
  createTestClock,
  insertBooking,
  registerUser,
  resetDatabase,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

const NOW = new Date("2026-10-20T06:30:00.000Z"); // Tue 20 Oct 2026, 12:00 IST
const clock = createTestClock(NOW);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let h: TestHarness;
let student: TestUser;
let other: TestUser;
let lab: string;

beforeAll(() => {
  h = createHarness({ clock: clock.now });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  clock.set(NOW);
  await resetDatabase(h.prisma);
  const dept = await createDepartment(h.prisma, "CSE");
  student = await registerUser(h, { email: "s@college.edu", departmentId: dept });
  other = await registerUser(h, { email: "o@college.edu", departmentId: dept });
  lab = await createResource(h.prisma, { departmentId: dept, name: "Systems Lab", maxSlotMinutes: 600 });
});

/** A booking `hoursFromNow` hours from NOW, one hour long. */
let slot = 0;
const booking = (userId: string, status: string, hoursFromNow = (slot += 2)) =>
  insertBooking(h.prisma, {
    resourceId: lab,
    userId,
    start: new Date(NOW.getTime() + hoursFromNow * HOUR),
    end: new Date(NOW.getTime() + hoursFromNow * HOUR + HOUR),
    status,
  });

const feedUrl = async (user: TestUser): Promise<string> => {
  const res = await request(h.app).get("/api/calendar/feed").set(user.auth);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.url as string;
};
/** Fetches a feed URL through the app (its host is the configured public API URL). */
const fetchFeed = (url: string) => request(h.app).get(new URL(url).pathname);
const uids = (ics: string): string[] => [...ics.matchAll(/^UID:(.+?)@labdesk\r?$/gm)].map((m) => m[1] ?? "");

describe("calendar feed", () => {
  it("lists only the owner's approved, checked-in and completed bookings", async () => {
    const shown = [
      await booking(student.id, "approved"),
      await booking(student.id, "checked_in", -1),
      await booking(student.id, "completed", -26),
    ];
    const hidden = [
      await booking(student.id, "pending"),
      await booking(student.id, "cancelled"),
      await booking(student.id, "rejected"), // includes expired: lapsed pending bookings become 'rejected'
      await booking(student.id, "no_show", -50),
      await booking(other.id, "approved"), // someone else's
      await booking(student.id, "completed", -100 * 24), // older than the 90-day lookback
    ];

    const url = await feedUrl(student);
    expect(url).toMatch(/^https:\/\/api\.labdesk\.test\/api\/calendar\/[A-Za-z0-9_-]{60,}\.ics$/);
    const res = await fetchFeed(url);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/calendar/);
    expect(res.headers["cache-control"]).toBe("no-store");

    const ics = res.text;
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(uids(ics).sort()).toEqual([...shown].sort());
    for (const id of hidden) expect(ics).not.toContain(id);
    expect(ics).toContain("SUMMARY:Systems Lab");
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("drops a booking from the feed once it is cancelled", async () => {
    const id = await booking(student.id, "approved");
    const url = await feedUrl(student);
    expect(uids((await fetchFeed(url)).text)).toEqual([id]);

    await request(h.app).post(`/api/bookings/${id}/cancel`).set(student.auth).expect(200);
    expect(uids((await fetchFeed(url)).text)).toEqual([]);
  });

  it("keeps the same URL until regenerated; regenerating revokes the old one", async () => {
    await booking(student.id, "approved");
    const first = await feedUrl(student);
    expect(await feedUrl(student)).toBe(first); // stable

    const regenerated = await request(h.app).post("/api/calendar/feed/regenerate").set(student.auth);
    expect(regenerated.status).toBe(200);
    const second = regenerated.body.data.url as string;
    expect(second).not.toBe(first);
    expect(await feedUrl(student)).toBe(second);

    const old = await fetchFeed(first);
    expect([old.status, old.body.error?.code]).toEqual([404, "NOT_FOUND"]);
    expect((await fetchFeed(second)).status).toBe(200);

    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: student.id, action: "user.calendar_feed_regenerated" } });
    expect(audit).toMatchObject({ actorId: student.id, before: { feedVersion: 1 }, after: { feedVersion: 2 } });
  });

  it("answers forged, malformed and deactivated-user feeds with the same 404", async () => {
    const url = await feedUrl(student);
    const token = new URL(url).pathname.replace("/api/calendar/", "").replace(".ics", "");
    // Change a character in the middle (the last one carries unused bits).
    const mid = Math.floor(token.length / 2);
    const flipped = `${token.slice(0, mid)}${token[mid] === "A" ? "B" : "A"}${token.slice(mid + 1)}`;
    for (const path of [`/api/calendar/${flipped}.ics`, "/api/calendar/nonsense.ics", `/api/calendar/${token}`]) {
      const res = await request(h.app).get(path);
      expect([path, res.status]).toEqual([path, 404]);
    }

    await h.prisma.user.update({ where: { id: student.id }, data: { isActive: false } });
    expect((await fetchFeed(url)).status).toBe(404);
  });

  it("requires a session to see or regenerate your own feed URL", async () => {
    expect((await request(h.app).get("/api/calendar/feed")).status).toBe(401);
    expect((await request(h.app).post("/api/calendar/feed/regenerate")).status).toBe(401);
    // Each user gets their own, different URL.
    expect(await feedUrl(student)).not.toBe(await feedUrl(other));
    // One day later the same URL still works (tokens don't expire; only regeneration revokes).
    const url = await feedUrl(student);
    clock.set(new Date(NOW.getTime() + DAY));
    expect((await fetchFeed(url)).status).toBe(200);
  });
});
