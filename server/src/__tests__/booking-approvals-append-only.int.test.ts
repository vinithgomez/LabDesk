import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  book,
  createDepartment,
  createHarness,
  createResource,
  istSlot,
  registerUser,
  resetDatabase,
  type TestHarness,
} from "../test/harness.js";

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

const snapshot = async () =>
  z
    .array(z.object({ id: z.string(), decision: z.string(), comment: z.string() }))
    .parse(
      await h.prisma.$queryRaw`
        SELECT id::text AS id, decision::text AS decision, comment FROM booking_approvals ORDER BY decided_at, id`,
    );

describe("booking_approvals is append-only", () => {
  it("rejects UPDATE and DELETE while INSERT keeps working", async () => {
    // A real decision, recorded by the application (approve -> transitionBooking).
    const dept = await createDepartment(h.prisma, "CSE");
    const booker = await registerUser(h, { email: "booker@college.edu", departmentId: dept });
    const owner = await registerUser(h, { email: "owner@college.edu", departmentId: dept, role: "faculty" });
    const lab = await createResource(h.prisma, { departmentId: dept, requiresApproval: true, ownerIds: [owner.id] });

    const first = await book(h, booker, { resourceId: lab, ...istSlot(1, "10:00", "11:00") });
    const approved = await request(h.app)
      .post(`/api/bookings/${first.body.data.id}/approve`)
      .set(owner.auth)
      .send({ comment: "ok" });
    expect(approved.status).toBe(200);

    const before = await snapshot();
    expect(before).toEqual([{ id: expect.any(String), decision: "approved", comment: "ok" }]);
    const rowId = before[0]!.id;

    // Raw SQL...
    await expect(
      h.prisma.$executeRaw`UPDATE booking_approvals SET decision = 'rejected' WHERE id = ${rowId}::uuid`,
    ).rejects.toThrow(/booking_approvals is append-only: UPDATE is not permitted/);
    await expect(h.prisma.$executeRaw`DELETE FROM booking_approvals WHERE id = ${rowId}::uuid`).rejects.toThrow(
      /booking_approvals is append-only: DELETE is not permitted/,
    );
    // ...and through the ORM, which is how application code would try it.
    await expect(
      h.prisma.bookingApproval.update({ where: { id: rowId }, data: { comment: "rewritten" } }),
    ).rejects.toThrow(/append-only/);
    await expect(h.prisma.bookingApproval.deleteMany({})).rejects.toThrow(/append-only/);

    // Nothing changed.
    expect(await snapshot()).toEqual(before);

    // Control: a plain INSERT still succeeds, so the rejections above are the
    // trigger at work, not a broken or read-only table.
    const second = await book(h, booker, { resourceId: lab, ...istSlot(1, "12:00", "13:00") });
    await h.prisma.$executeRaw`
      INSERT INTO booking_approvals (booking_id, level, approver_id, decision, comment)
      VALUES (${second.body.data.id}::uuid, 1, ${owner.id}::uuid, 'rejected', 'direct insert')`;
    const after = await snapshot();
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]);
  });
});
