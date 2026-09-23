import { describe, expect, it } from "vitest";
import type { Actor, UserRole } from "../domain/types.js";
import { bookingListScope, can, denial } from "./policy.js";

const DEPT_A = "dept-a";
const DEPT_B = "dept-b";

const actor = (role: UserRole, overrides: Partial<Actor> = {}): Actor => ({
  id: `${role}-1`,
  role,
  departmentId: DEPT_A,
  isActive: true,
  ...overrides,
});

describe("policy: resource:view", () => {
  it("allows same-department users and denies other departments", () => {
    expect(can(actor("student"), "resource:view", { departmentId: DEPT_A })).toBe(true);
    expect(can(actor("faculty"), "resource:view", { departmentId: DEPT_B })).toBe(false);
  });

  it("only admins may request an unscoped (all-department) view", () => {
    expect(can(actor("lab_incharge"), "resource:view", { departmentId: null })).toBe(false);
    expect(can(actor("admin"), "resource:view", { departmentId: null })).toBe(true);
    expect(can(actor("admin"), "resource:view", { departmentId: DEPT_B })).toBe(true);
  });

  it("denies inactive actors everything", () => {
    expect(can(actor("admin", { isActive: false }), "resource:view", { departmentId: DEPT_A })).toBe(false);
  });
});

describe("policy: resource:manage", () => {
  it("allows owners in their department and admins", () => {
    const faculty = actor("faculty");
    expect(can(faculty, "resource:manage", { departmentId: DEPT_A, ownerIds: [faculty.id] })).toBe(true);
    expect(can(actor("admin"), "resource:manage", { departmentId: DEPT_B, ownerIds: [] })).toBe(true);
  });

  it("denies non-owners regardless of role, and owners outside their department", () => {
    expect(can(actor("lab_incharge"), "resource:manage", { departmentId: DEPT_A, ownerIds: [] })).toBe(false);
    const faculty = actor("faculty");
    expect(can(faculty, "resource:manage", { departmentId: DEPT_B, ownerIds: [faculty.id] })).toBe(false);
  });
});

describe("policy: user:change_role", () => {
  it("allows admins to change other users' roles only", () => {
    const admin = actor("admin");
    expect(can(admin, "user:change_role", { targetUserId: "someone" })).toBe(true);
    expect(can(admin, "user:change_role", { targetUserId: admin.id })).toBe(false);
  });

  it("denies every non-admin role", () => {
    for (const role of ["student", "faculty", "lab_incharge"] as const) {
      expect(can(actor(role), "user:change_role", { targetUserId: "someone" })).toBe(false);
    }
  });
});

describe("policy: denial", () => {
  it("hides concrete resources in other departments behind NOT_FOUND", () => {
    const other = { id: "r-1", departmentId: DEPT_B, ownerIds: [] };
    expect(denial(actor("student"), "resource:view", other).code).toBe("NOT_FOUND");
    expect(denial(actor("faculty"), "resource:manage", other).code).toBe("NOT_FOUND");
  });

  it("uses FORBIDDEN for visible resources, listing scopes and everything else", () => {
    const own = { id: "r-1", departmentId: DEPT_A, ownerIds: [] };
    expect(denial(actor("student"), "resource:manage", own).code).toBe("FORBIDDEN");
    expect(denial(actor("student"), "resource:view", { departmentId: DEPT_B }).code).toBe("FORBIDDEN");
    expect(denial(actor("student"), "resource:manage", { departmentId: DEPT_B, ownerIds: [] }).code).toBe("FORBIDDEN");
    expect(denial(actor("student"), "user:change_role", { targetUserId: "x" }).code).toBe("FORBIDDEN");
  });

  it("never returns WRONG_DEPARTMENT for resource view/manage", () => {
    const subjects = [{ departmentId: DEPT_B }, { id: "r-1", departmentId: DEPT_B }, { departmentId: null }];
    for (const s of subjects) {
      expect(denial(actor("student"), "resource:view", s).code).not.toBe("WRONG_DEPARTMENT");
    }
  });
});

describe("policy: bookings", () => {
  const resourceA = { id: "r-a", departmentId: DEPT_A, isActive: true };
  const bookingBy = (userId: string, status: "pending" | "checked_in" = "pending", ownerIds: string[] = ["owner-1"]) => ({
    id: "b-1",
    userId,
    status,
    resource: { id: "r-a", departmentId: DEPT_A, ownerIds },
  });

  it("booking:create requires an active resource in the actor's own department, admins included", () => {
    expect(can(actor("student"), "booking:create", resourceA)).toBe(true);
    expect(can(actor("student"), "booking:create", { ...resourceA, isActive: false })).toBe(false);
    expect(can(actor("admin"), "booking:create", { ...resourceA, departmentId: DEPT_B })).toBe(false);
  });

  it("booking:create denials: hidden -> NOT_FOUND, visible-but-foreign -> WRONG_DEPARTMENT, inactive -> FORBIDDEN", () => {
    const foreign = { ...resourceA, departmentId: DEPT_B };
    expect(denial(actor("student"), "booking:create", foreign).code).toBe("NOT_FOUND");
    expect(denial(actor("admin"), "booking:create", foreign).code).toBe("WRONG_DEPARTMENT");
    expect(denial(actor("student"), "booking:create", { ...resourceA, isActive: false }).code).toBe("FORBIDDEN");
  });

  it("booking:view is booker, resource owner (same department) or admin", () => {
    const student = actor("student");
    expect(can(student, "booking:view", bookingBy(student.id))).toBe(true);
    expect(can(student, "booking:view", bookingBy("someone-else"))).toBe(false);
    expect(can(actor("faculty", { id: "owner-1" }), "booking:view", bookingBy("s"))).toBe(true);
    expect(can(actor("faculty", { id: "owner-1", departmentId: DEPT_B }), "booking:view", bookingBy("s"))).toBe(false);
    expect(can(actor("admin"), "booking:view", bookingBy("s"))).toBe(true);
    expect(denial(student, "booking:view", bookingBy("someone-else")).code).toBe("NOT_FOUND");
  });

  it("booking:cancel: booker until checked in; resource owner and admin always", () => {
    const student = actor("student");
    expect(can(student, "booking:cancel", bookingBy(student.id))).toBe(true);
    expect(can(student, "booking:cancel", bookingBy(student.id, "checked_in"))).toBe(false);
    expect(denial(student, "booking:cancel", bookingBy(student.id, "checked_in")).code).toBe("FORBIDDEN");
    expect(can(actor("faculty", { id: "owner-1" }), "booking:cancel", bookingBy("s", "checked_in"))).toBe(true);
    expect(can(actor("admin"), "booking:cancel", bookingBy("s", "checked_in"))).toBe(true);
    expect(can(actor("student", { id: "x" }), "booking:cancel", bookingBy("s"))).toBe(false);
    expect(denial(actor("student", { id: "x" }), "booking:cancel", bookingBy("s")).code).toBe("NOT_FOUND");
  });

  it("bookingListScope: admins all, others own-or-managed, mine narrows to own", () => {
    expect(bookingListScope(actor("admin"), { mine: false })).toEqual({ kind: "all" });
    expect(bookingListScope(actor("admin"), { mine: true })).toEqual({ kind: "own", userId: "admin-1" });
    expect(bookingListScope(actor("faculty"), { mine: false })).toEqual({ kind: "ownOrManaged", userId: "faculty-1" });
  });
});
