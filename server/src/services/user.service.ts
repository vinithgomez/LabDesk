import { DomainError } from "../domain/errors.js";
import type { Actor, User, UserRole, UserSearch, UserSummary } from "../domain/types.js";
import type { UnitOfWork } from "../repositories/index.js";

export class UserService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Callers must have passed `can(actor, "user:list", ...)` for the filter's department first. */
  list(filter: UserSearch): Promise<UserSummary[]> {
    return this.uow.read.users.search(filter);
  }

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
