import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api";
import type { Role } from "../auth/use-me";

/** GET /api/users: one row (server/src/routes/users.routes.ts userListItemDto). */
export interface UserRow {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  departmentId: string;
  isActive: boolean;
}

export interface UserQuery {
  q?: string;
  role?: Role;
  /** Omit for the admin's own department; "all" for every department. */
  departmentId?: string;
  activeOnly?: boolean;
}

/** The server returns at most this many per request. */
export const USER_LIST_CAP = 50;

function usersPath(query: UserQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.role) params.set("role", query.role);
  if (query.departmentId) params.set("departmentId", query.departmentId);
  if (query.activeOnly) params.set("activeOnly", "true");
  const qs = params.toString();
  return qs ? `/api/users?${qs}` : "/api/users";
}

/** Admin only; the server refuses everyone else. */
export function useUsers(query: UserQuery, enabled = true) {
  const path = usersPath(query);
  return useQuery({
    queryKey: ["users", path],
    queryFn: () => apiRequest<UserRow[]>(path, { method: "GET" }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/**
 * Names for user ids in a department: its people, plus admins anywhere
 * (admins may own resources in any department). There is no lookup by id,
 * so this covers at most the first 50 of each list.
 */
export function useNamesIn(departmentId: string | undefined) {
  const people = useUsers({ departmentId }, departmentId !== undefined);
  const admins = useUsers({ role: "admin", departmentId: "all" }, departmentId !== undefined);
  const byId = new Map<string, UserRow>();
  for (const u of [...(admins.data ?? []), ...(people.data ?? [])]) byId.set(u.id, u);
  return byId;
}

export function useChangeRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ user, role }: { user: UserRow; role: Role }) =>
      apiRequest<UserRow>(`/api/users/${user.id}/role`, { method: "PATCH", body: { role } }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}
