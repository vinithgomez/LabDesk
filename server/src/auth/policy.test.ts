import { describe, expect, it } from "vitest";
import type { Actor, UserRole } from "../domain/types.js";
import { can, denial } from "./policy.js";

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
  it("reports cross-department denials as WRONG_DEPARTMENT", () => {
    expect(denial(actor("student"), "resource:view", { departmentId: DEPT_B }).code).toBe("WRONG_DEPARTMENT");
    expect(denial(actor("student"), "resource:manage", { departmentId: DEPT_A, ownerIds: [] }).code).toBe("FORBIDDEN");
    expect(denial(actor("student"), "user:change_role", { targetUserId: "x" }).code).toBe("FORBIDDEN");
  });
});
