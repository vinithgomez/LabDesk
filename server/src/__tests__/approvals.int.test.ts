import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../domain/types.js";
import { createUnitOfWork } from "../repositories/index.js";
import { BookingService } from "../services/booking.service.js";
import {
  book,
  createDepartment,
  createHarness,
  createResource,
  istSlot,
  registerUser,
  resetDatabase,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

let h: TestHarness;
let dept: string;
let booker: TestUser;
let otherStudent: TestUser;
let faculty1: TestUser; // level-1 owner of both resources
let faculty2: TestUser; // second level-1 owner of the two-level resource
let incharge: TestUser; // level-2 owner of the two-level resource
let otherFaculty: TestUser; // same department, owns nothing
let admin: TestUser;
let foreignAdmin: TestUser;
let oneLevel: string;
let twoLevel: string;

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma);
  dept = await createDepartment(h.prisma, "CSE");
  const deptB = await createDepartment(h.prisma, "ECE");
  booker = await registerUser(h, { email: "booker@college.edu", departmentId: dept });
  otherStudent = await registerUser(h, { email: "other@college.edu", departmentId: dept });
  faculty1 = await registerUser(h, { email: "f1@college.edu", departmentId: dept, role: "faculty" });
  faculty2 = await registerUser(h, { email: "f2@college.edu", departmentId: dept, role: "faculty" });
  incharge = await registerUser(h, { email: "incharge@college.edu", departmentId: dept, role: "lab_incharge" });
  otherFaculty = await registerUser(h, { email: "f3@college.edu", departmentId: dept, role: "faculty" });
  admin = await registerUser(h, { email: "admin@college.edu", departmentId: dept, role: "admin" });
  foreignAdmin = await registerUser(h, { email: "ece.admin@college.edu", departmentId: deptB, role: "admin" });

  oneLevel = await createResource(h.prisma, {
    departmentId: dept,
    name: "Seminar Room",
    requiresApproval: true,
    approvalLevels: 1,
    owners: [{ userId: faculty1.id, approvalLevel: 1 }],
  });
  twoLevel = await createResource(h.prisma, {
    departmentId: dept,
    name: "GPU Box",
    requiresApproval: true,
    approvalLevels: 2,
    owners: [
      { userId: faculty1.id, approvalLevel: 1 },
      { userId: faculty2.id, approvalLevel: 1 },
      { userId: incharge.id, approvalLevel: 2 },
    ],
  });
});

let hour = 7;
async function pendingBooking(resourceId: string, by: TestUser = booker): Promise<string> {
  hour = hour >= 20 ? 8 : hour + 1;
  const hh = String(hour).padStart(2, "0");
  const res = await book(h, by, { resourceId, ...istSlot(1, `${hh}:00`, `${hh}:30`) });
  expect(res.status).toBe(201);
  expect(res.body.data.status).toBe("pending");
  return res.body.data.id as string;
}

const decide = (action: "approve" | "reject", user: TestUser, id: string, body: object = {}) =>
  request(h.app).post(`/api/bookings/${id}/${action}`).set(user.auth).send(body);
const approve = (user: TestUser, id: string, body?: object) => decide("approve", user, id, body);
const reject = (user: TestUser, id: string, body?: object) => decide("reject", user, id, body);

const statusOf = async (id: string) => (await h.prisma.booking.findUniqueOrThrow({ where: { id } })).status;
const decisionsOf = async (id: string) =>
  (await h.prisma.bookingApproval.findMany({ where: { bookingId: id }, orderBy: { level: "asc" } })).map(
    (a) => `${a.level}:${a.decision}:${a.approverId}`,
  );

describe("single-level approval", () => {
  it("lets the owner approve, recording the decision and auditing it", async () => {
    const id = await pendingBooking(oneLevel);
    const res = await approve(faculty1, id, { comment: "Enjoy the room" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: "approved",
      awaitingLevel: null,
      approvals: [{ level: 1, approverId: faculty1.id, decision: "approved", comment: "Enjoy the room" }],
    });
    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: id, action: "booking.approved" } });
    expect(audit?.actorId).toBe(faculty1.id);
    expect(audit?.before).toMatchObject({ status: "pending", approvals: [] });
    expect(audit?.after).toMatchObject({ status: "approved", approvals: [{ level: 1, decision: "approved" }] });
  });

  it("creates bookings on no-approval resources as approved, so there is nothing to approve", async () => {
    const open = await createResource(h.prisma, { departmentId: dept, name: "Open Lab", ownerIds: [faculty1.id] });
    const res = await book(h, booker, { resourceId: open, ...istSlot(1, "10:00", "11:00") });
    expect(res.body.data.status).toBe("approved");

    const again = await approve(faculty1, res.body.data.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("rejects unknown fields in the decision body", async () => {
    const id = await pendingBooking(oneLevel);
    const res = await approve(faculty1, id, { comment: "ok", level: 2 });
    expect(res.status).toBe(400);
    expect(await statusOf(id)).toBe("pending");
  });
});

describe("who may decide", () => {
  it("a student cannot approve their own booking (§6)", async () => {
    const id = await pendingBooking(oneLevel);
    const res = await approve(booker, id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(await statusOf(id)).toBe("pending");

    // Control: the owner can approve that same booking.
    expect((await approve(faculty1, id)).status).toBe(200);
  });

  it("an owner cannot approve or reject their own booking", async () => {
    const id = await pendingBooking(oneLevel, faculty1);
    for (const res of [await approve(faculty1, id), await reject(faculty1, id)]) {
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: "FORBIDDEN", message: "You cannot approve or reject your own booking" });
    }
    expect(await decisionsOf(id)).toEqual([]);

    // Control: an admin can decide it.
    expect((await approve(admin, id)).status).toBe(200);
  });

  it("non-owners and other students cannot decide (they cannot see the booking)", async () => {
    const id = await pendingBooking(oneLevel);
    for (const user of [otherFaculty, otherStudent]) {
      for (const res of [await approve(user, id), await reject(user, id)]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("NOT_FOUND");
      }
    }
    expect(await decisionsOf(id)).toEqual([]);

    // Control: the owner can.
    expect((await reject(faculty1, id)).status).toBe(200);
  });

  it("an admin decides only within their own department", async () => {
    const id = await pendingBooking(oneLevel);
    const foreign = await approve(foreignAdmin, id);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("WRONG_DEPARTMENT");
    expect(await statusOf(id)).toBe("pending");

    // Control: the department's own admin can.
    expect((await approve(admin, id)).status).toBe(200);
    expect(await statusOf(id)).toBe("approved");
  });
});

describe("two-level approval", () => {
  it("cannot approve level 2 before level 1, and moves to approved only after level 2", async () => {
    const id = await pendingBooking(twoLevel);

    const early = await approve(incharge, id);
    expect(early.status).toBe(403);
    expect(early.body.error.message).toBe("This booking is awaiting level 1 approval");
    expect(await decisionsOf(id)).toEqual([]);

    const level1 = await approve(faculty1, id);
    expect(level1.status).toBe(200);
    expect(level1.body.data).toMatchObject({ status: "pending", awaitingLevel: 2 });
    expect(await h.prisma.auditLog.count({ where: { entityId: id, action: "booking.level_approved" } })).toBe(1);

    // A level-1 owner cannot supply level 2.
    const wrongLevel = await approve(faculty2, id);
    expect(wrongLevel.status).toBe(403);
    expect(wrongLevel.body.error.message).toBe("This booking is awaiting level 2 approval");

    // Control: the level-2 owner completes it.
    const level2 = await approve(incharge, id);
    expect(level2.status).toBe(200);
    expect(level2.body.data).toMatchObject({ status: "approved", awaitingLevel: null });
    expect(await decisionsOf(id)).toEqual([`1:approved:${faculty1.id}`, `2:approved:${incharge.id}`]);
  });

  it("does not let the same approver satisfy both levels", async () => {
    const id = await pendingBooking(twoLevel);
    expect((await approve(admin, id)).status).toBe(200);

    const twice = await approve(admin, id);
    expect(twice.status).toBe(403);
    expect(twice.body.error.message).toMatch(/already decided/);
    expect(await statusOf(id)).toBe("pending");

    // Control: a different, level-2 approver completes it.
    expect((await approve(incharge, id)).status).toBe(200);
    expect(await statusOf(id)).toBe("approved");
  });

  it("treats a level-1 rejection as final: it never falls through to level 2", async () => {
    const id = await pendingBooking(twoLevel);
    const rejected = await reject(faculty1, id, { comment: "Not this week" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({ status: "rejected", awaitingLevel: null });

    const late = await approve(incharge, id);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("INVALID_TRANSITION");
    expect(await decisionsOf(id)).toEqual([`1:rejected:${faculty1.id}`]);
  });

  it("treats a level-2 rejection as final too", async () => {
    const id = await pendingBooking(twoLevel);
    await approve(faculty1, id);
    const res = await reject(incharge, id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("rejected");
    expect(await h.prisma.auditLog.count({ where: { entityId: id, action: "booking.rejected" } })).toBe(1);
  });
});

describe("B: rejection frees the held slot", () => {
  it("lets a second booking take the exact slot once the first is rejected", async () => {
    const slot = istSlot(2, "10:00", "11:00");
    const first = await book(h, booker, { resourceId: oneLevel, ...slot });
    expect(first.body.data.status).toBe("pending");

    // While pending, the request holds the slot (pending is in the constraint).
    const blocked = await book(h, otherStudent, { resourceId: oneLevel, ...slot });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("SLOT_CONFLICT");

    expect((await reject(faculty1, first.body.data.id)).status).toBe(200);

    // 'rejected' is outside the constraint's WHERE clause: the slot is free.
    const day = istSlot(2, "00:00", "00:00", 3);
    const availability = await request(h.app)
      .get(`/api/resources/${oneLevel}/availability`)
      .query({ from: day.start, to: day.end })
      .set(otherStudent.auth);
    expect(availability.body.data.busy).toEqual([]);

    const second = await book(h, otherStudent, { resourceId: oneLevel, ...slot });
    expect(second.status).toBe(201);
    expect(second.body.data.status).toBe("pending");

    // Both rows exist for the same period; only the new one holds it.
    const rows = await h.prisma.booking.findMany({ where: { resourceId: oneLevel }, select: { status: true } });
    expect(rows.map((r) => r.status).sort()).toEqual(["pending", "rejected"]);
  });
});

describe("timing and races", () => {
  it("won't approve a booking whose start has passed, but will still reject it", async () => {
    const id = await pendingBooking(oneLevel);
    await h.prisma.$executeRaw`
      UPDATE bookings SET period = tstzrange(now() - interval '10 minutes', now() + interval '20 minutes', '[)')
      WHERE id = ${id}::uuid`;

    const res = await approve(faculty1, id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already started/);
    expect((await reject(faculty1, id)).status).toBe(200);
  });

  it("refuses a decision authorized against a level that has since been decided", async () => {
    const id = await pendingBooking(twoLevel);
    expect((await approve(faculty1, id)).status).toBe(200);

    // faculty2 was authorized for level 1 before faculty1's decision landed.
    const service = new BookingService(createUnitOfWork(h.prisma));
    const faculty2Actor: Actor = { id: faculty2.id, role: "faculty", departmentId: dept, isActive: true };
    await expect(
      service.transitionBooking(id, "approve", faculty2Actor, { level: 1, comment: "" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await decisionsOf(id)).toEqual([`1:approved:${faculty1.id}`]);
  });

  it("lets exactly one of two concurrent level-1 approvals through", async () => {
    const id = await pendingBooking(twoLevel);
    const [a, b] = await Promise.all([approve(faculty1, id), approve(faculty2, id)]);

    // One wins; the other is refused either by the policy (it already sees
    // level 2 awaited: 403) or under the row lock (stale level: 409).
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect([a.status, b.status].filter((s) => s === 403 || s === 409)).toHaveLength(1);
    const decisions = await decisionsOf(id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatch(/^1:approved:/);
  });
});
