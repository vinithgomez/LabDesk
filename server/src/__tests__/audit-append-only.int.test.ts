import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDepartment, createHarness, registerUser, resetDatabase, type TestHarness } from "../test/harness.js";

let h: TestHarness;

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma);
});

const snapshot = async (): Promise<{ id: string; action: string }[]> =>
  z
    .array(z.object({ id: z.string(), action: z.string() }))
    .parse(await h.prisma.$queryRaw`SELECT id::text AS id, action FROM audit_log ORDER BY created_at, id`);

describe("audit_log is append-only", () => {
  it("rejects UPDATE and DELETE while INSERT keeps working", async () => {
    // A real audit row, written by the application (role change -> writeAudit).
    const dept = await createDepartment(h.prisma, "CSE");
    const admin = await registerUser(h, { email: "admin@college.edu", departmentId: dept, role: "admin" });
    const student = await registerUser(h, { email: "student@college.edu", departmentId: dept });
    const promoted = await request(h.app).patch(`/api/users/${student.id}/role`).set(admin.auth).send({ role: "faculty" });
    expect(promoted.status).toBe(200);

    const before = await snapshot();
    expect(before).toHaveLength(1);
    const rowId = before[0]!.id;

    // Raw SQL, as the task specifies...
    await expect(
      h.prisma.$executeRaw`UPDATE audit_log SET action = 'tampered' WHERE id = ${rowId}::uuid`,
    ).rejects.toThrow(/audit_log is append-only: UPDATE is not permitted/);
    await expect(h.prisma.$executeRaw`DELETE FROM audit_log WHERE id = ${rowId}::uuid`).rejects.toThrow(
      /audit_log is append-only: DELETE is not permitted/,
    );
    // ...and through the ORM, which is how application code would try it.
    await expect(h.prisma.auditLog.update({ where: { id: rowId }, data: { action: "tampered" } })).rejects.toThrow(
      /append-only/,
    );
    await expect(h.prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);

    // Nothing changed.
    expect(await snapshot()).toEqual(before);

    // Control: a plain INSERT still succeeds, so the rejections above are the
    // trigger at work, not a broken or read-only table.
    await h.prisma.$executeRaw`
      INSERT INTO audit_log (actor_id, entity_type, entity_id, action, before, after)
      VALUES (${admin.id}::uuid, 'user', ${student.id}::uuid, 'user.role_changed', NULL, '{"role":"faculty"}'::jsonb)`;
    const after = await snapshot();
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]);
  });
});
