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
let faculty1: TestUser; // level-1 owner of both resources
let incharge: TestUser; // level-2 owner of the two-level resource only
let otherFaculty: TestUser; // owns nothing
let admin: TestUser;
let foreignAdmin: TestUser;
let foreignStudent: TestUser;

// p1: one-level, awaiting level 1   p2: two-level, awaiting level 1
// p3: two-level, level 1 approved by faculty1, awaiting level 2
// done: already approved (not pending)   foreign: pending in another department
let ids: { p1: string; p2: string; p3: string; done: string; foreign: string };

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma);
  const dept = await createDepartment(h.prisma, "CSE");
  const deptB = await createDepartment(h.prisma, "ECE");
  booker = await registerUser(h, { email: "booker@college.edu", departmentId: dept });
  faculty1 = await registerUser(h, { email: "f1@college.edu", departmentId: dept, role: "faculty" });
  incharge = await registerUser(h, { email: "incharge@college.edu", departmentId: dept, role: "lab_incharge" });
  otherFaculty = await registerUser(h, { email: "f3@college.edu", departmentId: dept, role: "faculty" });
  admin = await registerUser(h, { email: "admin@college.edu", departmentId: dept, role: "admin" });
  foreignAdmin = await registerUser(h, { email: "ece.admin@college.edu", departmentId: deptB, role: "admin" });
  foreignStudent = await registerUser(h, { email: "ece.student@college.edu", departmentId: deptB });

  const oneLevel = await createResource(h.prisma, {
    departmentId: dept,
    name: "Seminar Room",
    requiresApproval: true,
    owners: [{ userId: faculty1.id, approvalLevel: 1 }],
  });
  const twoLevel = await createResource(h.prisma, {
    departmentId: dept,
    name: "GPU Box",
    requiresApproval: true,
    approvalLevels: 2,
    owners: [
      { userId: faculty1.id, approvalLevel: 1 },
      { userId: incharge.id, approvalLevel: 2 },
    ],
  });
  const foreignLab = await createResource(h.prisma, {
    departmentId: deptB,
    name: "ECE Lab",
    requiresApproval: true,
    ownerIds: [foreignAdmin.id],
  });

  const make = async (user: TestUser, resourceId: string, day: number, hh: string) => {
    const res = await book(h, user, { resourceId, ...istSlot(day, `${hh}:00`, `${hh}:30`) });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  // Created out of start order on purpose, to check the inbox sorts by start.
  const p3 = await make(booker, twoLevel, 1, "09");
  const p1 = await make(booker, oneLevel, 2, "10");
  const p2 = await make(booker, twoLevel, 1, "11");
  const done = await make(booker, oneLevel, 3, "10");
  const foreign = await make(foreignStudent, foreignLab, 1, "10");
  expect((await approve(faculty1, p3)).status).toBe(200);
  expect((await approve(faculty1, done)).status).toBe(200);
  ids = { p1, p2, p3, done, foreign };
});

const approve = (user: TestUser, id: string) => request(h.app).post(`/api/bookings/${id}/approve`).set(user.auth).send({});

interface InboxEntry {
  id: string;
  awaitingLevel: number | null;
  canDecide: boolean;
  stalled: boolean;
  lapsed: boolean;
  resource: { name: string };
}
async function inbox(user: TestUser, query: Record<string, string> = {}): Promise<InboxEntry[]> {
  const res = await request(h.app).get("/api/bookings/pending").query(query).set(user.auth);
  expect(res.status).toBe(200);
  return res.body.data as InboxEntry[];
}
const summary = (entries: InboxEntry[]) =>
  entries.map((e) => ({ id: e.id, awaitingLevel: e.awaitingLevel, canDecide: e.canDecide }));

describe("GET /api/bookings/pending", () => {
  it("shows an owner every pending booking on resources they own, soonest first", async () => {
    expect(summary(await inbox(faculty1))).toEqual([
      { id: ids.p3, awaitingLevel: 2, canDecide: false }, // faculty1 already decided level 1
      { id: ids.p2, awaitingLevel: 1, canDecide: true },
      { id: ids.p1, awaitingLevel: 1, canDecide: true },
    ]);
  });

  it("marks what each owner can decide by level, and filters with actionable=true", async () => {
    expect(summary(await inbox(incharge))).toEqual([
      { id: ids.p3, awaitingLevel: 2, canDecide: true },
      { id: ids.p2, awaitingLevel: 1, canDecide: false }, // level 1 hasn't decided yet
    ]);
    expect((await inbox(incharge, { actionable: "true" })).map((e) => e.id)).toEqual([ids.p3]);
    expect((await inbox(faculty1, { actionable: "true" })).map((e) => e.id)).toEqual([ids.p2, ids.p1]);
  });

  it("shows admins every pending booking in their own department only", async () => {
    expect((await inbox(admin)).map((e) => e.id)).toEqual([ids.p3, ids.p2, ids.p1]);
    expect((await inbox(foreignAdmin)).map((e) => e.id)).toEqual([ids.foreign]);
  });

  it("is empty for users who own nothing (with the owner inbox as control)", async () => {
    expect(await inbox(otherFaculty)).toEqual([]);
    expect(await inbox(booker)).toEqual([]);
    expect((await inbox(faculty1)).length).toBeGreaterThan(0);
  });

  it("flags a partially-approved booking as stalled once level 2 has waited 24h", async () => {
    const stalledOf = async (id: string) => (await inbox(admin)).find((e) => e.id === id)?.stalled;
    expect(await stalledOf(ids.p3)).toBe(false); // level 1 approved just now

    await h.prisma.$executeRaw`
      UPDATE booking_approvals SET decided_at = now() - interval '25 hours' WHERE booking_id = ${ids.p3}::uuid`;
    expect(await stalledOf(ids.p3)).toBe(true);

    // Waiting on level 1 is ordinary pending, not stalled, however old.
    await h.prisma.$executeRaw`UPDATE bookings SET created_at = now() - interval '3 days' WHERE id = ${ids.p2}::uuid`;
    expect(await stalledOf(ids.p2)).toBe(false);
  });

  it("flags bookings whose start has passed as lapsed", async () => {
    await h.prisma.$executeRaw`
      UPDATE bookings SET period = tstzrange(now() - interval '5 minutes', now() + interval '25 minutes', '[)')
      WHERE id = ${ids.p1}::uuid`;
    const entry = (await inbox(faculty1)).find((e) => e.id === ids.p1);
    expect(entry?.lapsed).toBe(true);
    expect((await inbox(faculty1)).find((e) => e.id === ids.p2)?.lapsed).toBe(false);
  });

  it("drops bookings from the inbox once decided", async () => {
    expect((await approve(incharge, ids.p3)).status).toBe(200);
    expect((await inbox(incharge)).map((e) => e.id)).toEqual([ids.p2]);
  });
});
