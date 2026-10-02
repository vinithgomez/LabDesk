import { Router } from "express";
import { z } from "zod";
import { can, defaultUserListScope, denial, type UserListSubject } from "../auth/policy.js";
import { USER_ROLES } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { UserService } from "../services/user.service.js";
import { idParams, userDto } from "./schemas.js";

export const changeRoleBody = z.strictObject({ role: z.enum(USER_ROLES) });

/** The most users one request returns. */
export const USER_LIST_CAP = 50;

export const listUsersQuery = z.object({
  /** Case-insensitive substring of the full name. */
  q: z.string().trim().max(100).optional(),
  role: z.enum(USER_ROLES).optional(),
  /** Defaults to the caller's own department; "all" or another id only when asked for. */
  departmentId: z.union([z.literal("all"), z.uuid()]).optional(),
  activeOnly: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(USER_LIST_CAP).default(USER_LIST_CAP),
});

/**
 * One row of a user listing. Declared field by field: respond() strips
 * anything else, so no credential, token or other column can ever appear.
 */
export const userListItemDto = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string(),
  role: z.enum(USER_ROLES),
  departmentId: z.string(),
  isActive: z.boolean(),
});
export const userListDto = z.array(userListItemDto);

export type ListUsersQuery = z.input<typeof listUsersQuery>;
export type UserListItemDto = z.output<typeof userListItemDto>;
export type ChangeRoleBody = z.input<typeof changeRoleBody>;

export function usersRouter(auth: AuthService, users: UserService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  /** Admin only (user:list). The caller's own department unless another, or "all", is asked for. */
  router.get("/", async (req, res) => {
    const actor = actorOf(req);
    const query = listUsersQuery.parse(req.query);
    const subject: UserListSubject =
      query.departmentId === "all"
        ? { departmentId: null }
        : query.departmentId
          ? { departmentId: query.departmentId }
          : defaultUserListScope(actor);
    if (!can(actor, "user:list", subject)) throw denial(actor, "user:list", subject);

    const found = await users.list({
      departmentId: subject.departmentId,
      q: query.q || undefined,
      role: query.role,
      activeOnly: query.activeOnly,
      limit: query.limit,
    });
    respond(res, 200, userListDto, found);
  });

  router.patch("/:id/role", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    const { role } = changeRoleBody.parse(req.body);

    const subject = { targetUserId: id };
    if (!can(actor, "user:change_role", subject)) throw denial(actor, "user:change_role", subject);

    respond(res, 200, userDto, await users.changeRole(actor, id, role));
  });

  return router;
}
