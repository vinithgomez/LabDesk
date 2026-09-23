import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDepartment,
  createHarness,
  createResource,
  registerUser,
  resetDatabase,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

let h: TestHarness;
let deptA: string;
let deptB: string;
let admin: TestUser;
let faculty: TestUser;
let incharge: TestUser;
let student: TestUser;
let foreignFaculty: TestUser;

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
  admin = await registerUser(h, { email: "admin@college.edu", departmentId: deptA, role: "admin" });
  faculty = await registerUser(h, { email: "faculty@college.edu", departmentId: deptA, role: "faculty" });
  incharge = await registerUser(h, { email: "incharge@college.edu", departmentId: deptA, role: "lab_incharge" });
  student = await registerUser(h, { email: "student@college.edu", departmentId: deptA });
  foreignFaculty = await registerUser(h, { email: "ece.faculty@college.edu", departmentId: deptB, role: "faculty" });
});

const putOwners = (user: TestUser, resourceId: string, owners: { userId: string; approvalLevel?: number }[]) =>
  request(h.app).patch(`/api/resources/${resourceId}/owners`).set(user.auth).send({ owners });

const ownersInDb = async (resourceId: string) =>
  (
    await h.prisma.resourceOwner.findMany({
      where: { resourceId },
      select: { userId: true, approvalLevel: true },
      orderBy: [{ approvalLevel: "asc" }, { userId: "asc" }],
    })
  ).map((o) => `${o.approvalLevel}:${o.userId}`);

describe("PATCH /api/resources/:id/owners", () => {
  it("lets an admin replace owners and levels, and audits the change", async () => {
    const lab = await createResource(h.prisma, {
      departmentId: deptA,
      requiresApproval: true,
      approvalLevels: 2,
      owners: [
        { userId: faculty.id, approvalLevel: 1 },
        { userId: incharge.id, approvalLevel: 2 },
      ],
    });

    const res = await putOwners(admin, lab, [
      { userId: incharge.id, approvalLevel: 1 },
      { userId: faculty.id, approvalLevel: 2 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.data.owners).toEqual(
      expect.arrayContaining([
        { userId: incharge.id, approvalLevel: 1 },
        { userId: faculty.id, approvalLevel: 2 },
      ]),
    );
    expect(await ownersInDb(lab)).toEqual([`1:${incharge.id}`, `2:${faculty.id}`]);

    const audit = await h.prisma.auditLog.findFirst({ where: { entityId: lab, action: "resource.owners_changed" } });
    expect(audit?.actorId).toBe(admin.id);
    expect(audit?.before).toMatchObject({ owners: expect.arrayContaining([{ userId: faculty.id, approvalLevel: 1 }]) });
    expect(audit?.after).toMatchObject({ owners: expect.arrayContaining([{ userId: faculty.id, approvalLevel: 2 }]) });
  });

  it("is admin-only: owners and other staff are refused", async () => {
    const lab = await createResource(h.prisma, { departmentId: deptA, ownerIds: [faculty.id] });

    for (const user of [faculty, incharge, student]) {
      const res = await putOwners(user, lab, [{ userId: incharge.id }]);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    expect(await ownersInDb(lab)).toEqual([`1:${faculty.id}`]);

    // Control: the admin can make exactly that change.
    expect((await putOwners(admin, lab, [{ userId: incharge.id }])).status).toBe(200);
  });

  it("hides other departments' resources from non-admins (404)", async () => {
    const foreignLab = await createResource(h.prisma, { departmentId: deptB, ownerIds: [foreignFaculty.id] });
    const res = await putOwners(faculty, foreignLab, [{ userId: faculty.id }]);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");

    // Control: an admin can manage it, with an owner from that department.
    const ok = await putOwners(admin, foreignLab, [{ userId: foreignFaculty.id }]);
    expect(ok.status).toBe(200);
  });

  it("rejects ineligible owners: students, inactive users, other departments", async () => {
    const lab = await createResource(h.prisma, { departmentId: deptA, ownerIds: [faculty.id] });
    const retired = await registerUser(h, { email: "retired@college.edu", departmentId: deptA, role: "faculty" });
    await h.prisma.user.update({ where: { id: retired.id }, data: { isActive: false } });

    const cases: [string, string][] = [
      [student.id, "students cannot own resources"],
      [retired.id, "user is inactive"],
      [foreignFaculty.id, "user is in another department"],
      ["7f1e4c2a-9b3d-4e5f-8a6b-1c2d3e4f5a6b", "user does not exist"],
    ];
    for (const [userId, reason] of cases) {
      const res = await putOwners(admin, lab, [{ userId }]);
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: "INVALID_OWNER", details: [{ userId, reason }] });
    }
    expect(await ownersInDb(lab)).toEqual([`1:${faculty.id}`]);

    // Admins may own resources in any department.
    const foreignLab = await createResource(h.prisma, { departmentId: deptB });
    expect((await putOwners(admin, foreignLab, [{ userId: admin.id }])).status).toBe(200);
  });

  it("rejects duplicate owners and levels the resource doesn't use", async () => {
    const lab = await createResource(h.prisma, { departmentId: deptA, approvalLevels: 1 });

    const dup = await putOwners(admin, lab, [{ userId: faculty.id }, { userId: faculty.id, approvalLevel: 1 }]);
    expect(dup.status).toBe(422);
    expect(dup.body.error.code).toBe("INVALID_OWNER");

    const level2 = await putOwners(admin, lab, [{ userId: faculty.id, approvalLevel: 2 }]);
    expect(level2.status).toBe(422);
    expect(level2.body.error.code).toBe("INVALID_OWNER");
  });

  it("refuses to remove the last owner of a resource that requires approval", async () => {
    const lab = await createResource(h.prisma, { departmentId: deptA, requiresApproval: true, ownerIds: [faculty.id] });

    const none = await putOwners(admin, lab, []);
    expect(none.status).toBe(422);
    expect(none.body.error).toMatchObject({ code: "OWNER_REQUIRED", details: { missingLevels: [1] } });
    expect(await ownersInDb(lab)).toEqual([`1:${faculty.id}`]);

    // Control: swapping in a different owner (never zero) is fine...
    expect((await putOwners(admin, lab, [{ userId: incharge.id }])).status).toBe(200);
    // ...and a resource that does not require approval may have no owners at all.
    const open = await createResource(h.prisma, { departmentId: deptA, ownerIds: [faculty.id] });
    expect((await putOwners(admin, open, [])).status).toBe(200);
  });

  it("refuses to leave a required second level without an owner", async () => {
    const lab = await createResource(h.prisma, {
      departmentId: deptA,
      requiresApproval: true,
      approvalLevels: 2,
      owners: [
        { userId: faculty.id, approvalLevel: 1 },
        { userId: incharge.id, approvalLevel: 2 },
      ],
    });

    const res = await putOwners(admin, lab, [{ userId: faculty.id, approvalLevel: 1 }]);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "OWNER_REQUIRED", details: { missingLevels: [2] } });
  });
});

describe("approval settings keep the owner invariant", () => {
  it("won't require approval, or add a level, that no owner can serve", async () => {
    const lab = await createResource(h.prisma, { departmentId: deptA, ownerIds: [faculty.id] });
    const patch = (body: Record<string, unknown>) =>
      request(h.app).patch(`/api/resources/${lab}`).set(admin.auth).send(body);

    // Level 2 would have no owner.
    const twoLevels = await patch({ requiresApproval: true, approvalLevels: 2 });
    expect(twoLevels.status).toBe(422);
    expect(twoLevels.body.error.code).toBe("OWNER_REQUIRED");

    // Control: one level is covered by the existing level-1 owner.
    expect((await patch({ requiresApproval: true })).status).toBe(200);

    // Creating a resource that requires approval with no owners is refused too.
    const create = await request(h.app)
      .post("/api/resources")
      .set(admin.auth)
      .send({ departmentId: deptA, name: "New", type: "room", location: "X", capacity: 5, requiresApproval: true });
    expect(create.status).toBe(422);
    expect(create.body.error.code).toBe("OWNER_REQUIRED");
  });
});
