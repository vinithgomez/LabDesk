import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../domain/types.js";
import { createUnitOfWork, type UnitOfWork } from "../repositories/index.js";
import { ResourceService } from "../services/resource.service.js";
import { UserService } from "../services/user.service.js";
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

/** Every audit row as raw JSON text, exactly as stored in Postgres. */
async function auditRowsAsText(): Promise<string[]> {
  const rows = await h.prisma.$queryRaw<{ row: string }[]>`SELECT row_to_json(a)::text AS row FROM audit_log a`;
  return rows.map((r) => r.row);
}

describe("audit log", () => {
  it("writes an audit row on a role change with correct before/after", async () => {
    const admin = await registerUser(h, { email: "admin@college.edu", departmentId: deptId, role: "admin" });
    const student = await registerUser(h, { email: "student@college.edu", departmentId: deptId });
    const startedAt = new Date();

    const res = await request(h.app).patch(`/api/users/${student.id}/role`).set(admin.auth).send({ role: "faculty" });
    expect(res.status).toBe(200);

    const rows = await h.prisma.auditLog.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      actorId: admin.id,
      entityType: "user",
      entityId: student.id,
      action: "user.role_changed",
    });
    expect(row.before).toMatchObject({ id: student.id, email: "student@college.edu", role: "student" });
    expect(row.after).toMatchObject({ id: student.id, email: "student@college.edu", role: "faculty" });
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime() - 1000);

    // The password hash is redacted: neither the key nor the value is stored.
    const { passwordHash } = await h.prisma.user.findUniqueOrThrow({ where: { id: student.id } });
    const [text] = await auditRowsAsText();
    expect(text).not.toMatch(/password/i);
    expect(text).not.toContain(passwordHash);
  });

  it("writes no audit row when the surrounding transaction fails after the mutation", async () => {
    const admin = await registerUser(h, { email: "admin@college.edu", departmentId: deptId, role: "admin" });
    const student = await registerUser(h, { email: "student@college.edu", departmentId: deptId });
    const actor: Actor = { id: admin.id, role: "admin", departmentId: deptId, isActive: true };
    const resource = await h.prisma.resource.create({
      data: { departmentId: deptId, name: "Lab", type: "lab", location: "A", capacity: 10 },
    });

    // The real unit of work, except the transaction throws once the service's
    // work — mutation AND audit write — has completed, forcing a rollback.
    // writeAudit calls are counted so zero rows can't pass vacuously.
    const real = createUnitOfWork(h.prisma);
    let auditWrites = 0;
    const failing: UnitOfWork = {
      read: real.read,
      transaction: (work) =>
        real.transaction(async (tx) => {
          await work({
            ...tx,
            writeAudit: async (entry) => {
              auditWrites += 1;
              await tx.writeAudit(entry);
            },
          });
          throw new Error("injected failure after mutation");
        }),
    };

    await expect(new UserService(failing).changeRole(actor, student.id, "faculty")).rejects.toThrow("injected");
    await expect(new ResourceService(failing).update(actor, resource.id, { capacity: 99 })).rejects.toThrow("injected");
    await expect(new ResourceService(failing).deactivate(actor, resource.id)).rejects.toThrow("injected");

    expect(auditWrites).toBe(3);
    expect(await h.prisma.auditLog.count()).toBe(0);
    // ...and the mutations themselves rolled back too.
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: student.id } })).role).toBe("student");
    const after = await h.prisma.resource.findUniqueOrThrow({ where: { id: resource.id } });
    expect(after.capacity).toBe(10);
    expect(after.isActive).toBe(true);

    // Control: the same service on the real unit of work does write the row.
    await new UserService(real).changeRole(actor, student.id, "faculty");
    expect(await h.prisma.auditLog.count()).toBe(1);
  });

  it("never stores qr_secret in an audit row across resource create, update and delete", async () => {
    const admin = await registerUser(h, { email: "admin@college.edu", departmentId: deptId, role: "admin" });
    const incharge = await registerUser(h, { email: "incharge@college.edu", departmentId: deptId, role: "lab_incharge" });

    const created = await request(h.app)
      .post("/api/resources")
      .set(admin.auth)
      .send({ departmentId: deptId, name: "GPU Box", type: "equipment", location: "R1", capacity: 1, ownerIds: [incharge.id] });
    expect(created.status).toBe(201);
    const id: string = created.body.data.id;

    const updated = await request(h.app).patch(`/api/resources/${id}`).set(incharge.auth).send({ name: "GPU Box v2" });
    expect(updated.status).toBe(200);
    const deleted = await request(h.app).delete(`/api/resources/${id}`).set(incharge.auth);
    expect(deleted.status).toBe(200);

    const rows = await h.prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["resource.created", "resource.updated", "resource.deactivated"]);
    // The update row records the actual change.
    expect(rows[1]?.before).toMatchObject({ name: "GPU Box" });
    expect(rows[1]?.after).toMatchObject({ name: "GPU Box v2" });

    const { qrSecret } = await h.prisma.resource.findUniqueOrThrow({ where: { id } });
    expect(qrSecret).toMatch(/^[0-9a-f]{64}$/);
    for (const text of await auditRowsAsText()) {
      expect(text).not.toContain(qrSecret);
      expect(text).not.toMatch(/qr_?secret/i);
    }
  });
});
