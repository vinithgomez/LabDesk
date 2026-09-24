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
