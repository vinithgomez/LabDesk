import { DomainError } from "../domain/errors.js";
import type { Actor, User, UserRole } from "../domain/types.js";
import type { UnitOfWork } from "../repositories/index.js";

export class UserService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Callers must have passed `can(actor, "user:change_role", ...)` first. */
  changeRole(actor: Actor, targetUserId: string, role: UserRole): Promise<User> {
    return this.uow.transaction(async (tx) => {
      await tx.users.lockById(targetUserId);
      const before = await tx.users.findById(targetUserId);
      if (!before) throw new DomainError("USER_NOT_FOUND", "User not found");

      const after = await tx.users.updateRole(targetUserId, role);
      await tx.writeAudit({
        actorId: actor.id,
        entityType: "user",
        entityId: targetUserId,
        action: "user.role_changed",
        before,
        after,
      });
      return after;
    });
  }
}
