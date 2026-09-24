import jsQR from "jsqr";
import { PNG } from "pngjs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signResourceQr } from "../auth/qr-signature.js";
import {
  createDepartment,
  createHarness,
  createResource,
  createTestClock,
  insertBooking,
  registerUser,
  resetDatabase,
  resetRedis,
  type TestHarness,
  type TestUser,
} from "../test/harness.js";

const MIN = 60_000;
const T0 = new Date("2026-10-05T04:30:00.000Z");
const clock = createTestClock(T0);
const at = (offsetMs: number, from: Date = T0) => new Date(from.getTime() + offsetMs);

let h: TestHarness;
let student: TestUser;
let otherStudent: TestUser;
let owner: TestUser; // faculty who owns `lab`
let otherFaculty: TestUser;
let admin: TestUser;
let foreignAdmin: TestUser;
let lab: string;

beforeAll(() => {
  h = createHarness({ clock: clock.now });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  clock.set(T0);
  await Promise.all([resetDatabase(h.prisma), resetRedis(h.redis)]);
  const dept = await createDepartment(h.prisma, "CSE");
  const deptB = await createDepartment(h.prisma, "ECE");
  student = await registerUser(h, { email: "student@college.edu", departmentId: dept });
  otherStudent = await registerUser(h, { email: "other@college.edu", departmentId: dept });
  owner = await registerUser(h, { email: "owner@college.edu", departmentId: dept, role: "faculty" });
  otherFaculty = await registerUser(h, { email: "faculty@college.edu", departmentId: dept, role: "faculty" });
  admin = await registerUser(h, { email: "admin@college.edu", departmentId: dept, role: "admin" });
  foreignAdmin = await registerUser(h, { email: "ece.admin@college.edu", departmentId: deptB, role: "admin" });
  lab = await createResource(h.prisma, { departmentId: dept, name: "Systems Lab", ownerIds: [owner.id] });
});

/** An approved booking for `user` on `resourceId`, starting `startOffset` after T0, 60 minutes long. */
const approvedBooking = (user: TestUser, startOffset: number, resourceId = lab, status = "approved") =>
  insertBooking(h.prisma, {
    resourceId,
    userId: user.id,
    start: at(startOffset),
    end: at(startOffset + 60 * MIN),
    status,
  });

const sigFor = async (resourceId: string) => {
  const { qrSecret } = await h.prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
  return signResourceQr(qrSecret, resourceId);
};
const scan = async (user: TestUser, resourceId = lab, sig?: string) =>
  request(h.app)
    .post("/api/checkin")
    .set(user.auth)
    .send({ resourceId, sig: sig ?? (await sigFor(resourceId)) });
const manual = (user: TestUser, bookingId: string) =>
  request(h.app).post("/api/checkin/manual").set(user.auth).send({ bookingId });
const statusOf = async (id: string) => (await h.prisma.booking.findUniqueOrThrow({ where: { id } })).status;
const checkinOf = (bookingId: string) => h.prisma.checkin.findUnique({ where: { bookingId } });

describe("GET /api/resources/:id/qr", () => {
  it("returns a PNG that decodes to the signed check-in URL, identically every time", async () => {
    const res = await request(h.app).get(`/api/resources/${lab}/qr`).set(owner.auth).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("no-store");

    const png = PNG.sync.read(res.body as Buffer);
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded?.data).toBe(`https://labdesk.test/checkin?r=${lab}&sig=${await sigFor(lab)}`);

    // Static and printable: reprinting yields the identical image.
    const again = await request(h.app).get(`/api/resources/${lab}/qr`).set(admin.auth).buffer(true);
    expect(Buffer.compare(again.body as Buffer, res.body as Buffer)).toBe(0);
  });

  it("is for managers only (resource:manage)", async () => {
    expect((await request(h.app).get(`/api/resources/${lab}/qr`).set(student.auth)).status).toBe(403);
    expect((await request(h.app).get(`/api/resources/${lab}/qr`).set(otherFaculty.auth)).status).toBe(403);
    expect((await request(h.app).get(`/api/resources/${lab}/qr`).set(foreignAdmin.auth)).status).toBe(200); // admins manage everywhere
    expect((await request(h.app).get(`/api/resources/${lab}/qr`).set(owner.auth)).status).toBe(200);
  });
});

describe("signature verification", () => {
  it("accepts the resource's own signature (control)", async () => {
    await approvedBooking(student, 5 * MIN);
    const res = await scan(student);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ action: "checked_in", booking: { status: "checked_in" } });
  });

  it("rejects tampered, borrowed and unknown codes identically", async () => {
    const id = await approvedBooking(student, 5 * MIN);
    const sig = await sigFor(lab);
    const otherLab = await createResource(h.prisma, { departmentId: (await h.prisma.resource.findUniqueOrThrow({ where: { id: lab } })).departmentId });
    const unknown = "7f1e4c2a-9b3d-4e5f-8a6b-1c2d3e4f5a6b";

    const cases = [
      await scan(student, lab, (sig[0] === "A" ? "B" : "A") + sig.slice(1)), // tampered
      await scan(student, lab, await sigFor(otherLab)), // another resource's signature
      await scan(student, unknown, sig), // unknown resource
    ];
    for (const res of cases) {
      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({ code: "INVALID_QR", message: "This is not a valid LabDesk check-in code" });
    }
    expect(await statusOf(id)).toBe("approved");
  });

  it("rejects a genuine code once the resource is retired (the QR has expired)", async () => {
    const id = await approvedBooking(student, 5 * MIN);
    await h.prisma.resource.update({ where: { id: lab }, data: { isActive: false } });
    const res = await scan(student);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "INVALID_QR", message: expect.stringMatching(/no longer in service/) });
    expect(await statusOf(id)).toBe("approved");
  });
});

describe("tolerance window edges", () => {
  // Each case gets its own booking a day apart, so they never interact.
  const DAY = 24 * 60 * MIN;

  it("opens exactly 15 minutes before the start", async () => {
    const early = await approvedBooking(student, 0);
    clock.set(at(-15 * MIN - 1));
    const tooEarly = await scan(student);
    expect(tooEarly.status).toBe(404);
    expect(tooEarly.body.error).toMatchObject({
      code: "NO_ACTIVE_BOOKING",
      details: { booking: { id: early, start: T0.toISOString() }, checkInOpensAt: at(-15 * MIN).toISOString() },
    });

    clock.set(at(-15 * MIN));
    expect((await scan(student)).status).toBe(200);
    expect(await statusOf(early)).toBe("checked_in");
  });

  it("closes exactly 15 minutes after the start (where the no-show rule begins)", async () => {
    const onTime = await approvedBooking(student, DAY);
    const late = await approvedBooking(student, 2 * DAY);

    clock.set(at(DAY + 15 * MIN));
    expect((await scan(student)).status).toBe(200);
    expect(await statusOf(onTime)).toBe("checked_in");

    clock.set(at(2 * DAY + 15 * MIN + 1));
    const tooLate = await scan(student);
    expect(tooLate.status).toBe(404);
    expect(tooLate.body.error.message).toContain(`closed at ${at(2 * DAY + 15 * MIN).toISOString()}`);
    expect(await statusOf(late)).toBe("approved");
  });

  it("lets a session check out until exactly 15 minutes after the end", async () => {
    const a = await approvedBooking(student, 0);
    const b = await approvedBooking(student, DAY);
    const endA = at(60 * MIN);
    const endB = at(DAY + 60 * MIN);

    await scan(student); // check in to a at T0
    clock.set(at(15 * MIN, endA));
    expect((await scan(student)).body.data?.action).toBe("checked_out");
    expect(await statusOf(a)).toBe("completed");

    clock.set(at(DAY));
    await scan(student); // check in to b
    clock.set(at(15 * MIN + 1, endB));
    expect((await scan(student)).status).toBe(404);
    expect(await statusOf(b)).toBe("checked_in"); // left for auto-complete
  });
});

describe("double scan", () => {
  it("checks in, then checks out, then has nothing left to do", async () => {
    const id = await approvedBooking(student, 0);

    const first = await scan(student);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({
      action: "checked_in",
      booking: { id, status: "checked_in" },
      resource: { id: lab, name: "Systems Lab" },
      checkin: { checkedInAt: T0.toISOString(), checkedOutAt: null, checkinMethod: "qr", overriddenBy: null },
    });

    clock.set(at(40 * MIN));
    const second = await scan(student);
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({
      action: "checked_out",
      booking: { id, status: "completed" },
      checkin: { checkedOutAt: at(40 * MIN).toISOString(), checkoutMethod: "qr" },
    });

    const third = await scan(student);
    expect(third.status).toBe(404);
    expect(third.body.error.code).toBe("NO_ACTIVE_BOOKING");

    const actions = (await h.prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "asc" } })).map(
      (a) => `${a.action}:${a.actorId === student.id}`,
    );
    expect(actions).toEqual(["booking.checked_in:true", "booking.checked_out:true"]);
  });

  it("checks out on the very next scan of the identical signed link, with zero elapsed time", async () => {
    // Regression test: reopening the same /checkin?r=&sig= link immediately
    // after checking in must check the session out, not report
    // NO_ACTIVE_BOOKING (the booking lookup must still see the resource's
    // checked_in bookings, not just approved ones).
    const id = await approvedBooking(student, 0);
    const payload = { resourceId: lab, sig: await sigFor(lab) };
    const postSamePayload = () => request(h.app).post("/api/checkin").set(student.auth).send(payload);

    const first = await postSamePayload();
    expect(first.status).toBe(200);
    expect(first.body.data.action).toBe("checked_in");
    expect(await statusOf(id)).toBe("checked_in");

    // No clock.set() here: the second request happens at the same instant.
    const second = await postSamePayload();
    expect(second.status).toBe(200);
    expect(second.body.error).toBeUndefined();
    expect(second.body.data).toMatchObject({
      action: "checked_out",
      booking: { id, status: "completed" },
      checkin: { checkinMethod: "qr", checkoutMethod: "qr", checkedOutAt: T0.toISOString() },
    });
    expect(await statusOf(id)).toBe("completed");
  });
});

describe("NO_ACTIVE_BOOKING", () => {
  it("names the nearby booking's actual time", async () => {
    await approvedBooking(student, 3 * 60 * MIN);
    const res = await scan(student);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(
      `Too early: your booking is ${at(180 * MIN).toISOString()}–${at(240 * MIN).toISOString()}. ` +
        `Check-in opens at ${at(165 * MIN).toISOString()}.`,
    );
  });

  it("explains a pending booking, and says plainly when there is none", async () => {
    await approvedBooking(student, 0, lab, "pending");
    expect((await scan(student)).body.error.message).toMatch(/still awaiting approval/);
    const none = await scan(otherStudent);
    expect(none.body.error).toEqual({
      code: "NO_ACTIVE_BOOKING",
      message: "You have no booking on this resource around this time.",
    });
  });

  it("never matches someone else's booking", async () => {
    const id = await approvedBooking(otherStudent, 0);
    expect((await scan(student)).status).toBe(404);
    expect(await statusOf(id)).toBe("approved");
  });
});

describe("scan rate limit", () => {
  it("allows 5 scans per user per resource per minute, counting failed ones", async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await scan(student, lab, "forged-signature");
      expect(res.status).toBe(422);
    }
    const sixth = await scan(student);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe("RATE_LIMITED");
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);

    // Controls: other users, and other resources for the same user, are unaffected.
    expect((await scan(otherStudent)).status).toBe(404);
    const otherLab = await createResource(h.prisma, { departmentId: (await h.prisma.resource.findUniqueOrThrow({ where: { id: lab } })).departmentId });
    expect((await scan(student, otherLab)).status).toBe(404);
  });
});

describe("manual override", () => {
  it("lets the resource owner check a student in and out, recording overridden_by", async () => {
    const id = await approvedBooking(student, 0);

    const checkIn = await manual(owner, id);
    expect(checkIn.status).toBe(200);
    expect(checkIn.body.data.checkin).toMatchObject({ checkinMethod: "manual_override", overriddenBy: owner.id });

    clock.set(at(30 * MIN));
    const checkOut = await manual(owner, id);
    expect(checkOut.status).toBe(200);
    expect(checkOut.body.data.checkin).toMatchObject({ checkoutMethod: "manual_override", checkoutOverriddenBy: owner.id });
    expect(await statusOf(id)).toBe("completed");

    const actions = (await h.prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "asc" } })).map(
      (a) => `${a.action}:${a.actorId === owner.id}`,
    );
    expect(actions).toEqual(["booking.checkin_overridden:true", "booking.checkout_overridden:true"]);
  });

  it("refuses everyone who is not staff for that resource, with an admin as control", async () => {
    const id = await approvedBooking(student, 0);

    const self = await manual(student, id); // the booker can see it, but can't override
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe("FORBIDDEN");
    for (const user of [otherStudent, otherFaculty]) {
      const res = await manual(user, id); // can't even see it
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    const foreign = await manual(foreignAdmin, id);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("WRONG_DEPARTMENT");
    expect(await checkinOf(id)).toBeNull();

    // Control: the department's admin can.
    expect((await manual(admin, id)).status).toBe(200);
    expect(await checkinOf(id)).toMatchObject({ overriddenBy: admin.id });
  });

  it("is not available on the staff member's own booking", async () => {
    const own = await approvedBooking(owner, 0);
    const res = await manual(owner, own);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/scan the QR code/);
  });

  it("applies the same time window, and reveals state only after authorization", async () => {
    const later = await approvedBooking(student, 3 * 60 * MIN);
    const tooEarly = await manual(owner, later);
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe("INVALID_TRANSITION");

    const cancelled = await approvedBooking(student, 0, lab, "cancelled");
    expect((await manual(otherStudent, cancelled)).status).toBe(404); // no state leak
    const staff = await manual(owner, cancelled);
    expect(staff.status).toBe(409);
    expect(staff.body.error.message).toMatch(/cancelled/);
  });
});
