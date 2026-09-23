import { Router } from "express";
import { z } from "zod";
import { can, denial } from "../auth/policy.js";
import { USER_ROLES } from "../domain/types.js";
import { actorOf, requireAuth } from "../http/authenticate.js";
import { respond } from "../http/respond.js";
import type { AuthService } from "../services/auth.service.js";
import type { UserService } from "../services/user.service.js";
import { idParams, userDto } from "./schemas.js";

export const changeRoleBody = z.strictObject({ role: z.enum(USER_ROLES) });
export type ChangeRoleBody = z.input<typeof changeRoleBody>;

export function usersRouter(auth: AuthService, users: UserService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.patch("/:id/role", async (req, res) => {
    const actor = actorOf(req);
    const { id } = idParams.parse(req.params);
    const { role } = changeRoleBody.parse(req.body);

    const subject = { targetUserId: id };
    if (!can(actor, "user:change_role", subject)) throw denial(actor, "user:change_role", subject);

    respond(res, 200, userDto, await users.changeRole(id, role));
  });

  return router;
}
