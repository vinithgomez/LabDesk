import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api";
import { useSession } from "./use-session";

export type Role = "student" | "faculty" | "lab_incharge" | "admin";

export interface Me {
  id: string;
  fullName: string;
  role: Role;
  departmentId: string;
  department: { id: string; name: string; code: string };
}

/** Roles that may open the analytics dashboard (the server enforces this too). */
export const ANALYTICS_ROLES: readonly Role[] = ["faculty", "lab_incharge", "admin"];

/** Staff: who sees the approvals inbox. Gating in the UI is a convenience; the server decides. */
export const STAFF_ROLES: readonly Role[] = ["faculty", "lab_incharge", "admin"];

export const ROLES: readonly Role[] = ["student", "faculty", "lab_incharge", "admin"];

export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  faculty: "Faculty",
  lab_incharge: "Lab in-charge",
  admin: "Admin",
};

export const isStaff = (me: Pick<Me, "role"> | undefined): boolean => (me ? STAFF_ROLES.includes(me.role) : false);
export const isAdmin = (me: Pick<Me, "role"> | undefined): boolean => me?.role === "admin";

/** The signed-in user (GET /api/auth/me), once a session exists. */
export function useMe() {
  const { status } = useSession();
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiRequest<Me>("/api/auth/me", { method: "GET" }),
    enabled: status === "signedIn",
    staleTime: Infinity,
  });
}
