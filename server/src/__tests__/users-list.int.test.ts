import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDepartment, createHarness, registerUser, resetDatabase, type TestHarness, type TestUser } from "../test/harness.js";

let h: TestHarness;
let cse: string;
let ece: string;
let admin: TestUser;
let student: TestUser;
let faculty: TestUser;
let incharge: TestUser;
let eceStudent: TestUser;

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma);
  cse = await createDepartment(h.prisma, "CSE");
  ece = await createDepartment(h.prisma, "ECE");
  admin = await registerUser(h, { email: "admin@college.edu", departmentId: cse, role: "admin" });
  student = await registerUser(h, { email: "student@college.edu", departmentId: cse });
  faculty = await registerUser(h, { email: "faculty@college.edu", departmentId: cse, role: "faculty" });
  incharge = await registerUser(h, { email: "incharge@college.edu", departmentId: cse, role: "lab_incharge" });
  eceStudent = await registerUser(h, { email: "ece.student@college.edu", departmentId: ece });
});

interface Row {
  id: string;
  fullName: string;
  email: string;
  role: string;
  departmentId: string;
  isActive: boolean;
}
const list = (user: TestUser, query: Record<string, string> = {}) =>
  request(h.app).get("/api/users").query(query).set(user.auth);
const ids = (rows: Row[]) => rows.map((r) => r.id).sort();

/** Bulk users straight into the table: registering 50+ through bcrypt would be slow. */
async function seedUsers(departmentId: string, count: number, prefix: string): Promise<void> {
  await h.prisma.user.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      email: `${prefix}${i}@college.edu`,
      passwordHash: "not-a-real-hash",
      fullName: `${prefix} ${String(i).padStart(2, "0")}`,
      departmentId,
    })),
  });
}

describe("GET /api/users: who may list", () => {
  it("refuses students, faculty and lab in-charges, with an admin as positive control", async () => {
    for (const user of [student, faculty, incharge, eceStudent]) {
      for (const query of [{}, { departmentId: cse }, { departmentId: "all" }] as Record<string, string>[]) {
        const res = await list(user, query);
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: { code: "FORBIDDEN", message: "Only admins can list users" } });
      }
    }
    const res = await list(admin);
    expect(res.status).toBe(200);
    expect(ids(res.body.data)).toEqual([admin.id, student.id, faculty.id, incharge.id].sort());
  });

  it("requires a session", async () => {
    expect((await request(h.app).get("/api/users")).status).toBe(401);
  });
});

describe("GET /api/users: department scope", () => {
  it("defaults to the admin's own department", async () => {
    const rows = (await list(admin)).body.data as Row[];
    expect(rows.every((r) => r.departmentId === cse)).toBe(true);
    expect(ids(rows)).not.toContain(eceStudent.id);
  });

  it("lists another department, or every department, only when asked explicitly", async () => {
    const other = (await list(admin, { departmentId: ece })).body.data as Row[];
    expect(ids(other)).toEqual([eceStudent.id]);

    const all = (await list(admin, { departmentId: "all" })).body.data as Row[];
    expect(ids(all)).toEqual([admin.id, student.id, faculty.id, incharge.id, eceStudent.id].sort());
  });

  it("rejects a malformed department", async () => {
    const res = await list(admin, { departmentId: "everything" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/users: filters and cap", () => {
  it("searches names case-insensitively and filters by role and active state", async () => {
    await h.prisma.user.update({ where: { id: faculty.id }, data: { fullName: "Dr. Anita Rao" } });
    await h.prisma.user.update({ where: { id: student.id }, data: { fullName: "Priya Nair", isActive: false } });

    expect(ids((await list(admin, { q: "anita" })).body.data)).toEqual([faculty.id]);
    expect(ids((await list(admin, { q: "RAO" })).body.data)).toEqual([faculty.id]);
    expect(ids((await list(admin, { role: "lab_incharge" })).body.data)).toEqual([incharge.id]);
    expect(ids((await list(admin, { role: "student" })).body.data)).toEqual([student.id]);
    expect(ids((await list(admin, { role: "student", activeOnly: "true" })).body.data)).toEqual([]);
    // Searches names, not emails: "faculty" is only in faculty@college.edu, now named Dr. Anita Rao.
    expect((await list(admin, { q: "faculty" })).body.data).toEqual([]);
  });

  it("orders by name", async () => {
    await seedUsers(cse, 3, "zeta");
    const names = ((await list(admin)).body.data as Row[]).map((r) => r.fullName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  });

  it("returns at most 50 users per request", async () => {
    await seedUsers(cse, 60, "bulk");
    const all = await list(admin);
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(50);

    expect((await list(admin, { limit: "10" })).body.data).toHaveLength(10);
    const tooMany = await list(admin, { limit: "51" });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/users: what a row contains", () => {
  it("has exactly id, fullName, email, role, departmentId and isActive, and nothing sensitive", async () => {
    await h.prisma.user.update({ where: { id: student.id }, data: { rollNo: "CS21-042" } });
    const res = await list(admin, { departmentId: "all" });
    expect(res.status).toBe(200);
    for (const row of res.body.data as Row[]) {
      expect(Object.keys(row).sort()).toEqual(["departmentId", "email", "fullName", "id", "isActive", "role"]);
    }
    const body = JSON.stringify(res.body);
    const hashes = await h.prisma.user.findMany({ select: { passwordHash: true } });
    for (const { passwordHash } of hashes) expect(body).not.toContain(passwordHash);
    for (const leaked of ["passwordHash", "password", "token", "icsFeedVersion", "rollNo", "CS21-042", "createdAt"]) {
      expect(body).not.toContain(leaked);
    }
    expect(body).not.toContain(admin.token);
  });
});
