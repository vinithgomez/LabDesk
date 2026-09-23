import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
let booker: TestUser;
let otherStudent: TestUser;
let owner: TestUser; // faculty who owns the lab
let otherFaculty: TestUser; // faculty in the same department, not an owner
let admin: TestUser;
let lab: string;

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma);
  const dept = await createDepartment(h.prisma, "CSE");
  booker = await registerUser(h, { email: "booker@college.edu", departmentId: dept });
  otherStudent = await registerUser(h, { email: "other@college.edu", departmentId: dept });
  owner = await registerUser(h, { email: "owner@college.edu", departmentId: dept, role: "faculty" });
  otherFaculty = await registerUser(h, { email: "faculty@college.edu", departmentId: dept, role: "faculty" });
  admin = await registerUser(h, { email: "admin@college.edu", departmentId: dept, role: "admin" });
  lab = await createResource(h.prisma, { departmentId: dept, ownerIds: [owner.id] });
});

let slotHour = 8;
/** A fresh pending booking by `booker`, each in its own hour. */
async function newBooking(): Promise<string> {
  slotHour = slotHour >= 20 ? 8 : slotHour + 1;
  const hh = String(slotHour).padStart(2, "0");
  const res = await book(h, booker, { resourceId: lab, ...istSlot(1, `${hh}:00`, `${hh}:30`) });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

const cancel = (user: TestUser, id: string) => request(h.app).post(`/api/bookings/${id}/cancel`).set(user.auth);
const statusOf = async (id: string): Promise<string | undefined> =>
  (await h.prisma.booking.findUnique({ where: { id }, select: { status: true } }))?.status;

describe("cancel permissions", () => {
  it("lets the booker cancel their own booking, and audits it", async () => {
    const id = await newBooking();
    const res = await cancel(booker, id);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: id, action: "booking.cancelled" } });
    expect(audit).toMatchObject({ actorId: booker.id, entityType: "booking" });
    expect(audit?.before).toMatchObject({ status: "pending" });
    expect(audit?.after).toMatchObject({ status: "cancelled" });
  });

  it("does not let another student cancel it (they cannot even see it)", async () => {
    const id = await newBooking();
    const res = await cancel(otherStudent, id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Booking not found" } });
    expect(await statusOf(id)).toBe("pending");
    expect(await h.prisma.auditLog.count({ where: { action: "booking.cancelled" } })).toBe(0);

    // Control: the booker can cancel the very same booking.
    expect((await cancel(booker, id)).status).toBe(200);
  });

  it("lets the resource owner cancel a student's booking", async () => {
    const id = await newBooking();
    const res = await cancel(owner, id);
    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("does not let faculty who don't own the resource cancel it", async () => {
    const id = await newBooking();
    expect((await cancel(otherFaculty, id)).status).toBe(404);
    expect(await statusOf(id)).toBe("pending");

    // Control: the owner can.
    expect((await cancel(owner, id)).status).toBe(200);
  });

  it("lets an admin cancel any booking", async () => {
    const id = await newBooking();
    expect((await cancel(admin, id)).status).toBe(200);
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("stops the booker once checked in; staff hit the state machine instead", async () => {
    const id = await newBooking();
    // Check-in is Phase 4; put the row into that state directly for this test.
    await h.prisma.$executeRaw`UPDATE bookings SET status = 'checked_in' WHERE id = ${id}::uuid`;

    // Policy: the booker may no longer cancel (§6)...
    const byBooker = await cancel(booker, id);
    expect(byBooker.status).toBe(403);
    expect(byBooker.body.error.code).toBe("FORBIDDEN");

    // ...and the state machine forbids cancel from checked_in for everyone (§5).
    const byOwner = await cancel(owner, id);
    expect(byOwner.status).toBe(409);
    expect(byOwner.body.error.code).toBe("INVALID_TRANSITION");
    expect(await statusOf(id)).toBe("checked_in");

    // Control: the same owner can cancel a booking that is still pending.
    expect((await cancel(owner, await newBooking())).status).toBe(200);
  });

  it("cannot cancel the same booking twice", async () => {
    const id = await newBooking();
    expect((await cancel(booker, id)).status).toBe(200);
    const again = await cancel(booker, id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("view permissions", () => {
  it("shows a booking to its booker, the resource owner and admins only", async () => {
    const id = await newBooking();
    const get = (user: TestUser, bookingId = id) => request(h.app).get(`/api/bookings/${bookingId}`).set(user.auth);

    for (const user of [booker, owner, admin]) {
      const res = await get(user);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(id);
    }

    // Not visible looks exactly like not existing.
    const missing = await get(otherStudent, "7f1e4c2a-9b3d-4e5f-8a6b-1c2d3e4f5a6b");
    for (const user of [otherStudent, otherFaculty]) {
      const res = await get(user);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(missing.body);
    }
  });

  it("scopes GET /api/bookings to what the actor may view", async () => {
    const mine = await newBooking();
    const theirs = await book(h, otherStudent, { resourceId: lab, ...istSlot(2, "10:00", "11:00") });
    expect(theirs.status).toBe(201);
    const list = async (user: TestUser, query: Record<string, string> = {}): Promise<string[]> => {
      const res = await request(h.app).get("/api/bookings").query(query).set(user.auth);
      expect(res.status).toBe(200);
      return (res.body.data as { id: string }[]).map((b) => b.id).sort();
    };

    // Students see only their own bookings.
    expect(await list(booker)).toEqual([mine]);
    expect(await list(otherStudent)).toEqual([theirs.body.data.id]);
    expect(await list(otherFaculty)).toEqual([]);

    // The owner sees every booking on their resource; mine=true narrows to own.
    expect(await list(owner)).toEqual([mine, theirs.body.data.id].sort());
    expect(await list(owner, { mine: "true" })).toEqual([]);
    expect(await list(admin)).toEqual([mine, theirs.body.data.id].sort());

    // Filters.
    await cancel(booker, mine);
    expect(await list(owner, { status: "cancelled" })).toEqual([mine]);
    expect(await list(owner, { status: "pending,approved" })).toEqual([theirs.body.data.id]);
    const day2 = istSlot(2, "00:00", "00:00", 3);
    expect(await list(admin, { from: day2.start, to: day2.end })).toEqual([theirs.body.data.id]);
  });
});
