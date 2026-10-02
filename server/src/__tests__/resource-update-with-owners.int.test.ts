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

/**
 * PATCH /api/resources/:id with `owners`: settings and owners change in one
 * transaction, validated as a whole. This is what lets an admin move a
 * resource that requires approval from one approval level to two (or back)
 * without ever switching approval off.
 */

let h: TestHarness;
let dept: string;
let admin: TestUser;
let faculty: TestUser; // level-1 owner
let incharge: TestUser; // becomes the level-2 owner
let student: TestUser;
let lab: string;

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma);
  dept = await createDepartment(h.prisma, "CSE");
  admin = await registerUser(h, { email: "admin@college.edu", departmentId: dept, role: "admin" });
  faculty = await registerUser(h, { email: "faculty@college.edu", departmentId: dept, role: "faculty" });
  incharge = await registerUser(h, { email: "incharge@college.edu", departmentId: dept, role: "lab_incharge" });
  student = await registerUser(h, { email: "student@college.edu", departmentId: dept });
  // Requires approval, one level, owned at level 1 by `faculty`.
  lab = await createResource(h.prisma, {
    departmentId: dept,
    name: "GPU Box",
    requiresApproval: true,
    approvalLevels: 1,
    owners: [{ userId: faculty.id, approvalLevel: 1 }],
  });
});

const patch = (user: TestUser, body: Record<string, unknown>) =>
  request(h.app).patch(`/api/resources/${lab}`).set(user.auth).send(body);

/** The resource row and its owners, read straight from the database. */
async function stored() {
  const row = await h.prisma.resource.findUniqueOrThrow({
    where: { id: lab },
    select: {
      requiresApproval: true,
      approvalLevels: true,
      capacity: true,
      owners: { select: { userId: true, approvalLevel: true }, orderBy: { approvalLevel: "asc" } },
    },
  });
  return row;
}

/** Two approval levels, with owners for both (a function: user ids exist only after beforeEach). */
const twoLevels = () => ({
  approvalLevels: 2,
  owners: [
    { userId: faculty.id, approvalLevel: 1 },
    { userId: incharge.id, approvalLevel: 2 },
  ],
});

describe("PATCH /api/resources/:id with owners", () => {
  it("goes from one approval level to two when the level-2 owner comes in the same request", async () => {
    // Before this change, neither order of two requests could do it.
    expect((await patch(admin, { approvalLevels: 2 })).body.error.code).toBe("OWNER_REQUIRED");
    const ownersFirst = await request(h.app)
      .patch(`/api/resources/${lab}/owners`)
      .set(admin.auth)
      .send({ owners: twoLevels().owners });
    expect(ownersFirst.status).toBe(422);
    expect(ownersFirst.body.error.code).toBe("INVALID_OWNER"); // level 2 doesn't exist yet

    const res = await patch(admin, twoLevels());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ requiresApproval: true, approvalLevels: 2 });
    expect(res.body.data.owners).toEqual(
      expect.arrayContaining([
        { userId: faculty.id, approvalLevel: 1 },
        { userId: incharge.id, approvalLevel: 2 },
      ]),
    );
    expect(await stored()).toEqual({
      requiresApproval: true,
      approvalLevels: 2,
      capacity: 30,
      owners: [
        { userId: faculty.id, approvalLevel: 1 },
        { userId: incharge.id, approvalLevel: 2 },
      ],
    });
  });

  it("goes back from two levels to one, dropping the level-2 owner, in one request", async () => {
    expect((await patch(admin, twoLevels())).status).toBe(200);
    const res = await patch(admin, { approvalLevels: 1, owners: [{ userId: faculty.id, approvalLevel: 1 }] });
    expect(res.status).toBe(200);
    expect(await stored()).toMatchObject({
      requiresApproval: true,
      approvalLevels: 1,
      owners: [{ userId: faculty.id, approvalLevel: 1 }],
    });
  });

  it("rejects two levels with only level-1 owners, and changes nothing", async () => {
    const before = await stored();
    const res = await patch(admin, {
      approvalLevels: 2,
      capacity: 12,
      owners: [
        { userId: faculty.id, approvalLevel: 1 },
        { userId: incharge.id, approvalLevel: 1 },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("OWNER_REQUIRED");
    expect(res.body.error.details).toEqual({ missingLevels: [2] });
    // Rolled back as a whole: levels, the other field and the owners are untouched.
    expect(await stored()).toEqual(before);
    expect(await h.prisma.auditLog.count({ where: { entityId: lab } })).toBe(0);
  });

  it("applies the same owner eligibility rules as PATCH /owners, and rolls back", async () => {
    const before = await stored();
    for (const owner of [student.id, "00000000-0000-4000-8000-000000000000"]) {
      const res = await patch(admin, { capacity: 12, owners: [{ userId: owner, approvalLevel: 1 }] });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("INVALID_OWNER");
    }
    await h.prisma.user.update({ where: { id: incharge.id }, data: { isActive: false } });
    const inactive = await patch(admin, { owners: [{ userId: incharge.id, approvalLevel: 1 }] });
    expect(inactive.body.error.code).toBe("INVALID_OWNER");
    const duplicate = await patch(admin, {
      owners: [
        { userId: faculty.id, approvalLevel: 1 },
        { userId: faculty.id, approvalLevel: 1 },
      ],
    });
    expect(duplicate.body.error.code).toBe("INVALID_OWNER");
    expect(await stored()).toEqual(before);
  });

  it("is admin-only for owners: a resource owner and other staff are refused, an admin is not", async () => {
    // The level-1 owner may edit the resource's settings…
    expect((await patch(faculty, { capacity: 25 })).status).toBe(200);
    // …but not its owners, in this request any more than on PATCH /owners.
    const owner = await patch(faculty, twoLevels());
    expect(owner.status).toBe(403);
    expect(owner.body.error.code).toBe("FORBIDDEN");
    const other = await patch(incharge, twoLevels());
    expect(other.status).toBe(403);
    const asStudent = await patch(student, twoLevels());
    expect(asStudent.status).toBe(403);
    expect(await stored()).toMatchObject({ approvalLevels: 1, capacity: 25, owners: [{ userId: faculty.id, approvalLevel: 1 }] });

    // Positive control: the same body works for an admin.
    expect((await patch(admin, twoLevels())).status).toBe(200);
  });

  it("audits the settings change and the owner change, in that order, in the same transaction", async () => {
    expect((await patch(admin, twoLevels())).status).toBe(200);
    const rows = await h.prisma.auditLog.findMany({
      where: { entityType: "resource", entityId: lab },
      select: { action: true, actorId: true, before: true, after: true },
    });
    expect(rows.map((r) => r.action).sort()).toEqual(["resource.owners_changed", "resource.updated"]);
    expect(rows.every((r) => r.actorId === admin.id)).toBe(true);
    const settings = rows.find((r) => r.action === "resource.updated");
    const owners = rows.find((r) => r.action === "resource.owners_changed");
    if (!settings || !owners) throw new Error("audit rows missing");
    // Chained: the owner change starts from the state the settings change produced.
    expect(owners.before).toEqual(settings.after);
    expect(settings.before).toMatchObject({ approvalLevels: 1 });
    expect(settings.after).toMatchObject({ approvalLevels: 2 });
    expect(owners.before).toMatchObject({ approvalLevels: 2, owners: [{ userId: faculty.id, approvalLevel: 1 }] });
    expect(owners.after).toMatchObject({ approvalLevels: 2 });
    expect((owners.after as { owners: unknown[] }).owners).toHaveLength(2);
    // Both are written inside the one transaction: writeAudit exists only on
    // transaction-scoped repositories, and a refused change leaves no audit
    // row at all (see the OWNER_REQUIRED test above).
  });

  it("only owners: audits just the owner change", async () => {
    expect((await patch(admin, { owners: [{ userId: incharge.id, approvalLevel: 1 }] })).status).toBe(200);
    const actions = await h.prisma.auditLog.findMany({ where: { entityId: lab }, select: { action: true } });
    expect(actions.map((a) => a.action)).toEqual(["resource.owners_changed"]);
  });

  it("never lets a booking through unapproved: requires_approval stays true throughout the change", async () => {
    // Bookings race the change; each takes FOR SHARE on the resource, so it
    // sees the whole old state or the whole new one. Either way approval is
    // required, so every booking is pending.
    const slots = Array.from({ length: 8 }, (_, i) => istSlot(1 + (i % 4), `${String(9 + Math.floor(i / 4) * 2).padStart(2, "0")}:00`, `${String(9 + Math.floor(i / 4) * 2).padStart(2, "0")}:30`));
    const [change, ...bookings] = await Promise.all([
      patch(admin, twoLevels()),
      ...slots.map((s) => book(h, student, { resourceId: lab, ...s })),
    ]);
    expect(change.status).toBe(200);
    expect(bookings.map((b) => b.status)).toEqual(slots.map(() => 201));
    expect(bookings.map((b) => b.body.data.status)).toEqual(slots.map(() => "pending"));

    // And no state with approval switched off was ever written, not even inside the transaction.
    const audit = await h.prisma.auditLog.findMany({ where: { entityType: "resource", entityId: lab }, select: { before: true, after: true } });
    expect(audit.length).toBeGreaterThan(0);
    for (const row of audit) {
      expect((row.before as { requiresApproval: boolean }).requiresApproval).toBe(true);
      expect((row.after as { requiresApproval: boolean }).requiresApproval).toBe(true);
    }
    expect((await stored()).requiresApproval).toBe(true);
  });

  it("keeps PATCH /owners working on its own", async () => {
    const res = await request(h.app)
      .patch(`/api/resources/${lab}/owners`)
      .set(admin.auth)
      .send({ owners: [{ userId: incharge.id, approvalLevel: 1 }] });
    expect(res.status).toBe(200);
    expect((await stored()).owners).toEqual([{ userId: incharge.id, approvalLevel: 1 }]);
  });
});
