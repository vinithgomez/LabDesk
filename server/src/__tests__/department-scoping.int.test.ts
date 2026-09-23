import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe("department scoping", () => {
  it("prevents a user from seeing or modifying resources in another department", async () => {
    const deptA = await createDepartment(h.prisma, "CSE");
    const deptB = await createDepartment(h.prisma, "ECE");

    const studentA = await registerUser(h, { email: "student.a@college.edu", departmentId: deptA });
    // Staff with management rights in their own department must still be
    // locked out of the other one.
    const inchargeA = await registerUser(h, { email: "incharge.a@college.edu", departmentId: deptA, role: "lab_incharge" });
    const inchargeB = await registerUser(h, { email: "incharge.b@college.edu", departmentId: deptB, role: "lab_incharge" });

    const base = { location: "Block", capacity: 10 } as const;
    const labA = await h.prisma.resource.create({
      data: { ...base, departmentId: deptA, name: "CSE Lab", type: "lab", owners: { create: [{ userId: inchargeA.id }] } },
    });
    const labB = await h.prisma.resource.create({
      data: { ...base, departmentId: deptB, name: "ECE Lab", type: "lab", owners: { create: [{ userId: inchargeB.id }] } },
    });

    // What a genuinely missing resource looks like. Another department's
    // resource must be indistinguishable from this (CLAUDE.md §2c).
    const missingId = "7f1e4c2a-9b3d-4e5f-8a6b-1c2d3e4f5a6b";
    const notFound = { error: { code: "NOT_FOUND", message: "Resource not found" } };
    const missing = await request(h.app).get(`/api/resources/${missingId}`).set(studentA.auth);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(notFound);

    for (const user of [studentA, inchargeA]) {
      // Positive control: same-department access works.
      const ownGet = await request(h.app).get(`/api/resources/${labA.id}`).set(user.auth);
      expect(ownGet.status).toBe(200);
      expect(ownGet.body.data.id).toBe(labA.id);

      // Listing only returns the user's own department...
      const list = await request(h.app).get("/api/resources").set(user.auth);
      expect(list.status).toBe(200);
      expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([labA.id]);

      // ...and explicitly asking for the other department's listing is
      // refused. Departments are public, so there is nothing to hide here.
      const listB = await request(h.app).get(`/api/resources?departmentId=${deptB}`).set(user.auth);
      expect(listB.status).toBe(403);
      expect(listB.body.error.code).toBe("FORBIDDEN");

      // Reading, updating or deactivating the other department's resource
      // looks exactly like the resource does not exist.
      const get = await request(h.app).get(`/api/resources/${labB.id}`).set(user.auth);
      const patch = await request(h.app).patch(`/api/resources/${labB.id}`).set(user.auth).send({ name: "Hijacked" });
      const del = await request(h.app).delete(`/api/resources/${labB.id}`).set(user.auth);
      for (const res of [get, patch, del]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(notFound);
      }

      const create = await request(h.app)
        .post("/api/resources")
        .set(user.auth)
        .send({ departmentId: deptB, name: "Planted", type: "room", location: "X", capacity: 1 });
      expect(create.status).toBe(403);
      expect(create.body.error.code).toBe("FORBIDDEN");
    }

    // The other department's resource is untouched and nothing was planted.
    const after = await h.prisma.resource.findUniqueOrThrow({ where: { id: labB.id } });
    expect(after.name).toBe("ECE Lab");
    expect(after.isActive).toBe(true);
    expect(await h.prisma.resource.count({ where: { departmentId: deptB } })).toBe(1);

    // Control: ECE's own in-charge can see and manage it.
    const ownB = await request(h.app).patch(`/api/resources/${labB.id}`).set(inchargeB.auth).send({ capacity: 12 });
    expect(ownB.status).toBe(200);
    expect(ownB.body.data.capacity).toBe(12);
    // And the QR secret never leaks through the API.
    expect(ownB.body.data).not.toHaveProperty("qrSecret");
  });
});
