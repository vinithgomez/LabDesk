import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  book,
  createDepartment,
  createHarness,
  createMaintenanceWindow,
  createResource,
  istSlot,
  registerUser,
  resetDatabase,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

let h: TestHarness;
let deptA: string;
let deptB: string;
let student: TestUser;
let otherStudent: TestUser;
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
  deptA = await createDepartment(h.prisma, "CSE");
  deptB = await createDepartment(h.prisma, "ECE");
  student = await registerUser(h, { email: "student@college.edu", departmentId: deptA });
  otherStudent = await registerUser(h, { email: "other@college.edu", departmentId: deptA });
  admin = await registerUser(h, { email: "admin@college.edu", departmentId: deptA, role: "admin" });
  // capacity 30, 30–120 minute slots, 7-day horizon
  lab = await createResource(h.prisma, { departmentId: deptA, name: "CSE Lab" });
});

const bookingCount = (): Promise<number> => h.prisma.booking.count();

describe("POST /api/bookings", () => {
  it("creates a booking in UTC and records an audit row", async () => {
    const slot = istSlot(1, "10:00", "11:00");
    const res = await book(h, student, { resourceId: lab, ...slot, purpose: "OS lab", attendeeCount: 4 });

    // `lab` does not require approval, so the booking is born 'approved'.
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      resourceId: lab,
      userId: student.id,
      status: "approved",
      purpose: "OS lab",
      attendeeCount: 4,
      start: new Date(slot.start).toISOString(),
      end: new Date(slot.end).toISOString(),
    });
    expect(res.body.data.start).toMatch(/Z$/);

    const audit = await h.prisma.auditLog.findMany({ where: { entityType: "booking" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: student.id, entityId: res.body.data.id, action: "booking.created" });
    expect(audit[0]?.before).toBeNull();
    expect(audit[0]?.after).toMatchObject({ status: "approved" });
  });

  it("creates bookings as 'pending' on resources that require approval", async () => {
    const gated = await createResource(h.prisma, {
      departmentId: deptA,
      name: "Gated Lab",
      requiresApproval: true,
      ownerIds: [admin.id],
    });
    const res = await book(h, student, { resourceId: gated, ...istSlot(1, "10:00", "11:00") });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
  });

  it("requires an Idempotency-Key header", async () => {
    const res = await request(h.app)
      .post("/api/bookings")
      .set(student.auth)
      .send({ resourceId: lab, ...istSlot(1, "10:00", "11:00") });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await bookingCount()).toBe(0);
  });

  it("replays the original booking for a repeated Idempotency-Key", async () => {
    const body = { resourceId: lab, ...istSlot(1, "10:00", "11:00"), purpose: "Project" };

    const first = await book(h, student, body, "retry-me");
    expect(first.status).toBe(201);

    const replay = await book(h, student, body, "retry-me");
    expect(replay.status).toBe(200);
    expect(replay.body.meta).toEqual({ code: "IDEMPOTENT_REPLAY" });
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.data).toEqual(first.body.data);

    // Nothing new was written: one booking, one audit row.
    expect(await bookingCount()).toBe(1);
    expect(await h.prisma.auditLog.count({ where: { action: "booking.created" } })).toBe(1);

    // The same key for a *different* request is a client bug, not a replay.
    const reused = await book(h, student, { ...body, purpose: "Something else" }, "retry-me");
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    // Keys are scoped per user: another user's identical key is independent.
    const otherUser = await book(h, otherStudent, { resourceId: lab, ...istSlot(1, "12:00", "13:00") }, "retry-me");
    expect(otherUser.status).toBe(201);
    expect(await bookingCount()).toBe(2);
  });

  it("rejects each slot-rule violation with its own code", async () => {
    const cases: { name: string; body: Record<string, unknown>; status: number; code: string }[] = [
      {
        name: "crosses IST midnight",
        body: istSlot(1, "23:30", "00:30", 2),
        status: 422,
        code: "MULTI_DAY_NOT_SUPPORTED",
      },
      { name: "longer than max_slot_minutes (120)", body: istSlot(1, "09:00", "12:00"), status: 422, code: "SLOT_TOO_LONG" },
      { name: "shorter than min_slot_minutes (30)", body: istSlot(1, "09:00", "09:15"), status: 422, code: "SLOT_TOO_SHORT" },
      { name: "in the past", body: istSlot(-1, "10:00", "11:00"), status: 422, code: "OUTSIDE_HORIZON" },
      { name: "beyond the 7-day horizon", body: istSlot(10, "10:00", "11:00"), status: 422, code: "OUTSIDE_HORIZON" },
      {
        name: "more attendees than capacity (30)",
        body: { ...istSlot(1, "10:00", "11:00"), attendeeCount: 31 },
        status: 422,
        code: "CAPACITY_EXCEEDED",
      },
      { name: "end before start", body: istSlot(1, "11:00", "10:00"), status: 400, code: "VALIDATION_ERROR" },
    ];

    for (const c of cases) {
      const res = await book(h, student, { resourceId: lab, ...c.body });
      expect({ case: c.name, status: res.status, code: res.body.error?.code }).toEqual({
        case: c.name,
        status: c.status,
        code: c.code,
      });
    }
    expect(await bookingCount()).toBe(0);

    // Control: a slot that follows every rule is accepted. Ending exactly at
    // IST midnight is still the same day ([start, end) is half-open).
    const ok = await book(h, student, { resourceId: lab, ...istSlot(1, "23:00", "00:00", 2), attendeeCount: 30 });
    expect(ok.status).toBe(201);
  });

  it("rejects bookings overlapping a maintenance window, but allows adjacent ones", async () => {
    const window = istSlot(1, "14:00", "16:00");
    await createMaintenanceWindow(h.prisma, { resourceId: lab, ...window, createdBy: admin.id });

    const overlapping = await book(h, student, { resourceId: lab, ...istSlot(1, "15:00", "16:30") });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe("MAINTENANCE_BLOCKED");

    const before = await book(h, student, { resourceId: lab, ...istSlot(1, "13:00", "14:00") });
    const after = await book(h, student, { resourceId: lab, ...istSlot(1, "16:00", "17:00") });
    expect([before.status, after.status]).toEqual([201, 201]);
  });

  it("returns SLOT_CONFLICT for an overlap and frees the slot once cancelled", async () => {
    const first = await book(h, student, { resourceId: lab, ...istSlot(1, "10:00", "11:00") });
    expect(first.status).toBe(201);

    const overlap = await book(h, otherStudent, { resourceId: lab, ...istSlot(1, "10:30", "11:30") });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe("SLOT_CONFLICT");

    // Half-open ranges: back-to-back bookings do not overlap.
    const adjacent = await book(h, otherStudent, { resourceId: lab, ...istSlot(1, "11:00", "12:00") });
    expect(adjacent.status).toBe(201);

    // Cancelled bookings no longer hold the slot.
    const cancel = await request(h.app).post(`/api/bookings/${first.body.data.id}/cancel`).set(student.auth);
    expect(cancel.status).toBe(200);
    const retry = await book(h, otherStudent, { resourceId: lab, ...istSlot(1, "10:00", "11:00") });
    expect(retry.status).toBe(201);
  });

  it("only allows booking active resources in the actor's own department", async () => {
    const foreignLab = await createResource(h.prisma, { departmentId: deptB, name: "ECE Lab" });
    const retiredLab = await createResource(h.prisma, { departmentId: deptA, name: "Old Lab", isActive: false });
    const slot = istSlot(1, "10:00", "11:00");

    // A student cannot even see another department's resource.
    const hidden = await book(h, student, { resourceId: foreignLab, ...slot });
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe("NOT_FOUND");

    // An admin can see it, but booking is still own-department only.
    const foreign = await book(h, admin, { resourceId: foreignLab, ...slot });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("WRONG_DEPARTMENT");

    const inactive = await book(h, student, { resourceId: retiredLab, ...slot });
    expect(inactive.status).toBe(403);
    expect(inactive.body.error.code).toBe("FORBIDDEN");
    expect(await bookingCount()).toBe(0);

    // Controls: both can book an active resource in their own department.
    expect((await book(h, student, { resourceId: lab, ...slot })).status).toBe(201);
    expect((await book(h, admin, { resourceId: lab, ...istSlot(1, "12:00", "13:00") })).status).toBe(201);
  });
});

describe("GET /api/resources/:id/availability", () => {
  it("lists slot-holding bookings and maintenance without booker identity", async () => {
    const kept = await book(h, student, { resourceId: lab, ...istSlot(1, "10:00", "11:00") });
    const dropped = await book(h, student, { resourceId: lab, ...istSlot(1, "12:00", "13:00") });
    await request(h.app).post(`/api/bookings/${dropped.body.data.id}/cancel`).set(student.auth);
    await createMaintenanceWindow(h.prisma, { resourceId: lab, ...istSlot(1, "14:00", "15:00"), createdBy: admin.id });

    const day = istSlot(1, "00:00", "00:00", 2);
    const res = await request(h.app)
      .get(`/api/resources/${lab}/availability`)
      .query({ from: day.start, to: day.end })
      .set(otherStudent.auth);

    expect(res.status).toBe(200);
    expect(res.body.data.busy).toEqual([
      { kind: "booking", status: "approved", start: kept.body.data.start, end: kept.body.data.end },
      {
        kind: "maintenance",
        start: new Date(istSlot(1, "14:00", "15:00").start).toISOString(),
        end: new Date(istSlot(1, "14:00", "15:00").end).toISOString(),
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(student.id);
  });

  it("hides other departments' resources and validates the window", async () => {
    const foreignLab = await createResource(h.prisma, { departmentId: deptB });
    const day = istSlot(1, "00:00", "00:00", 2);

    const hidden = await request(h.app)
      .get(`/api/resources/${foreignLab}/availability`)
      .query({ from: day.start, to: day.end })
      .set(student.auth);
    expect(hidden.status).toBe(404);

    const tooWide = await request(h.app)
      .get(`/api/resources/${lab}/availability`)
      .query({ from: day.start, to: istSlot(40, "00:00", "00:00").start })
      .set(student.auth);
    expect(tooWide.status).toBe(400);

    // Control: same department, sane window.
    const ok = await request(h.app)
      .get(`/api/resources/${lab}/availability`)
      .query({ from: day.start, to: day.end })
      .set(student.auth);
    expect(ok.status).toBe(200);
  });
});
