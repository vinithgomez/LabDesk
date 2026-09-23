import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDepartment, createHarness, registerUser, resetDatabase, type TestHarness } from "../test/harness.js";

let h: TestHarness;
let deptId: string;

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma);
  deptId = await createDepartment(h.prisma, "CSE");
});

const roleInDb = async (id: string): Promise<string | undefined> =>
  (await h.prisma.user.findUnique({ where: { id }, select: { role: true } }))?.role;

describe("registration", () => {
  it("defaults a new registration to role 'student'", async () => {
    const res = await request(h.app).post("/api/auth/register").send({
      email: "new.user@college.edu",
      password: "correct-horse-battery",
      fullName: "New User",
      departmentId: deptId,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe("student");
    expect(res.body.data.user.isActive).toBe(true);
    expect(await roleInDb(res.body.data.user.id)).toBe("student");

    const me = await request(h.app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.data.accessToken}`);
    expect(me.body.data.role).toBe("student");

    // A client cannot choose its own role at signup: the key is rejected
    // outright and no account is created.
    const smuggled = await request(h.app).post("/api/auth/register").send({
      email: "sneaky@college.edu",
      password: "correct-horse-battery",
      fullName: "Sneaky",
      departmentId: deptId,
      role: "admin",
    });
    expect(smuggled.status).toBe(400);
    expect(smuggled.body.error.code).toBe("VALIDATION_ERROR");
    expect(await h.prisma.user.count({ where: { email: "sneaky@college.edu" } })).toBe(0);
  });
});

describe("role changes", () => {
  it("does not let a student promote themselves or anyone else", async () => {
    const student = await registerUser(h, { email: "student@college.edu", departmentId: deptId });
    const other = await registerUser(h, { email: "other@college.edu", departmentId: deptId });

    for (const targetId of [student.id, other.id]) {
      for (const role of ["faculty", "lab_incharge", "admin"] as const) {
        const res = await request(h.app).patch(`/api/users/${targetId}/role`).set(student.auth).send({ role });
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: { code: "FORBIDDEN", message: expect.any(String) } });
      }
    }
    expect(await roleInDb(student.id)).toBe("student");
    expect(await roleInDb(other.id)).toBe("student");

    // Control: the same endpoint works for an admin, so the 403s above come
    // from the policy, not from a broken route.
    const admin = await registerUser(h, { email: "admin@college.edu", departmentId: deptId, role: "admin" });
    const promoted = await request(h.app).patch(`/api/users/${other.id}/role`).set(admin.auth).send({ role: "faculty" });
    expect(promoted.status).toBe(200);
    expect(await roleInDb(other.id)).toBe("faculty");
  });
});
