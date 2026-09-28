import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDepartment,
  createHarness,
  createResource,
  insertBooking,
  registerUser,
  resetDatabase,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

let h: TestHarness;
let dept: string;
let lab: string;
let otherLab: string;
let booker: TestUser;
let bystander: TestUser;
let owner: TestUser;
let admin: TestUser;
let outsider: TestUser;

const HOUR = 3_600_000;
let slot = 0;
const booking = (resourceId: string, user: TestUser, status: string) => {
  slot += 1;
  const start = new Date(Date.now() - (slot + 2) * 24 * HOUR);
  return insertBooking(h.prisma, { resourceId, userId: user.id, start, end: new Date(start.getTime() + HOUR), status });
};

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma);
  dept = await createDepartment(h.prisma, "CSE");
  const ece = await createDepartment(h.prisma, "ECE");
  booker = await registerUser(h, { email: "booker@college.edu", departmentId: dept });
  bystander = await registerUser(h, { email: "bystander@college.edu", departmentId: dept });
  owner = await registerUser(h, { email: "owner@college.edu", departmentId: dept, role: "lab_incharge" });
  admin = await registerUser(h, { email: "admin@college.edu", departmentId: ece, role: "admin" });
  outsider = await registerUser(h, { email: "outsider@college.edu", departmentId: ece, role: "lab_incharge" });
  lab = await createResource(h.prisma, { departmentId: dept, name: "Systems Lab", ownerIds: [owner.id] });
  otherLab = await createResource(h.prisma, { departmentId: dept, name: "Other Lab" });
});

const report = (user: TestUser, body: Record<string, unknown> = {}) =>
  request(h.app)
    .post("/api/incidents")
    .set(user.auth)
    .send({ resourceId: lab, severity: "major", description: "Monitor 12 cracked", ...body });
const reported = async (user: TestUser, body: Record<string, unknown> = {}): Promise<string> => {
  const res = await report(user, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
};

describe("reporting an incident", () => {
  it("is open to anyone who has had a booking on the resource, and to its managers", async () => {
    // Denied: never booked it, or only ever had bookings that never held the slot.
    expect([(await report(bystander)).status, (await report(bystander)).body.error.code]).toEqual([403, "FORBIDDEN"]);
    for (const status of ["pending", "cancelled", "rejected"]) await booking(lab, bystander, status);
    expect((await report(bystander)).status).toBe(403);
    // Another department can't even see the resource.
    expect([(await report(outsider)).status, (await report(outsider)).body.error.code]).toEqual([404, "NOT_FOUND"]);

    // Positive controls.
    await booking(lab, booker, "completed");
    const res = await report(booker, { severity: "out_of_service", description: "  Power supply smoking  " });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      resourceId: lab, reportedBy: booker.id, severity: "out_of_service", description: "Power supply smoking",
      bookingId: null, resolvedAt: null, resolvedBy: null,
    });
    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: res.body.data.id, action: "incident.reported" } });
    expect(audit?.actorId).toBe(booker.id);

    expect((await report(owner)).status).toBe(201); // owner, no booking needed
    expect((await report(admin)).status).toBe(201); // admin, any department
    // A no-show still counts as having had the booking.
    const noShow = await registerUser(h, { email: "noshow@college.edu", departmentId: dept });
    await booking(lab, noShow, "no_show");
    expect((await report(noShow)).status).toBe(201);
  });

  it("ties a report to a booking only on the same resource, and only your own unless you manage it", async () => {
    const mine = await booking(lab, booker, "completed");
    const theirs = await booking(lab, bystander, "completed");
    const elsewhere = await booking(otherLab, booker, "completed");

    expect((await report(booker, { bookingId: mine })).status).toBe(201);
    const notMine = await report(booker, { bookingId: theirs });
    expect([notMine.status, notMine.body.error.code]).toEqual([403, "FORBIDDEN"]);
    expect((await report(booker, { bookingId: elsewhere })).status).toBe(400);
    // The owner found the damage after someone else's session.
    const found = await report(owner, { bookingId: theirs });
    expect(found.status).toBe(201);
    expect(found.body.data.bookingId).toBe(theirs);
  });
});

describe("viewing incidents", () => {
  it("shows an incident to its reporter and the resource's managers only", async () => {
    await booking(lab, booker, "completed");
    const id = await reported(booker);
    const cases = { reporter: [booker, 200], owner: [owner, 200], admin: [admin, 200], bystander: [bystander, 404], outsider: [outsider, 404] } as const;
    for (const [label, [user, status]] of Object.entries(cases)) {
      const res = await request(h.app).get(`/api/incidents/${id}`).set(user.auth);
      expect([label, res.status]).toEqual([label, status]);
    }
  });

  it("lists a resource's incidents for its managers, and your own reports for you", async () => {
    await booking(lab, booker, "completed");
    const a = await reported(booker);
    const b = await reported(owner, { severity: "minor", description: "Loose cable" });

    const forOwner = await request(h.app).get("/api/incidents").query({ resourceId: lab }).set(owner.auth);
    expect(forOwner.body.data.map((i: { id: string }) => i.id).sort()).toEqual([a, b].sort());
    const forBooker = await request(h.app).get("/api/incidents").query({ resourceId: lab }).set(booker.auth);
    expect([forBooker.status, forBooker.body.error.code]).toEqual([403, "FORBIDDEN"]);
    expect((await request(h.app).get("/api/incidents").query({ resourceId: lab }).set(outsider.auth)).status).toBe(404);

    const own = await request(h.app).get("/api/incidents").set(booker.auth);
    expect(own.body.data.map((i: { id: string }) => i.id)).toEqual([a]);
  });
});

describe("resolving an incident", () => {
  it("is for the resource's owners and admins, once", async () => {
    await booking(lab, booker, "completed");
    const id = await reported(booker);
    const resolve = (user: TestUser, resolution?: string) =>
      request(h.app).patch(`/api/incidents/${id}/resolve`).set(user.auth).send(resolution === undefined ? {} : { resolution });

    const byReporter = await resolve(booker);
    expect([byReporter.status, byReporter.body.error.code]).toEqual([403, "FORBIDDEN"]); // can see it, can't resolve it
    expect((await resolve(bystander)).status).toBe(404);
    expect((await resolve(outsider)).status).toBe(404);

    const ok = await resolve(owner, "Replaced the monitor");
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ resolvedBy: owner.id, resolution: "Replaced the monitor" });
    expect(ok.body.data.resolvedAt).not.toBeNull();
    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: id, action: "incident.resolved" } });
    expect(audit).toMatchObject({ actorId: owner.id, before: { resolvedAt: null } });

    const again = await resolve(owner);
    expect([again.status, again.body.error.code]).toEqual([409, "INVALID_TRANSITION"]);

    // Admin positive control, from another department (as for maintenance).
    const second = await reported(booker, { severity: "minor", description: "Chair broken" });
    const byAdmin = await request(h.app).patch(`/api/incidents/${second}/resolve`).set(admin.auth).send({});
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.data.resolution).toBe("");

    const open = await request(h.app).get("/api/incidents").query({ resourceId: lab, state: "open" }).set(owner.auth);
    expect(open.body.data).toEqual([]);
    const all = await request(h.app).get("/api/incidents").query({ resourceId: lab, state: "all" }).set(owner.auth);
    expect(all.body.data).toHaveLength(2);
  });
});
