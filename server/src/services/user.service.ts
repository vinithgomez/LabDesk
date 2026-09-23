import { DomainError } from "../domain/errors.js";
import type { User, UserRole } from "../domain/types.js";
import type { UnitOfWork } from "../repositories/index.js";

export class UserService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Callers must have passed `can(actor, "user:change_role", ...)` first. */
  changeRole(targetUserId: string, role: UserRole): Promise<User> {
    return this.uow.transaction(async (repos) => {
      const target = await repos.users.findById(targetUserId);
      if (!target) throw new DomainError("USER_NOT_FOUND", "User not found");
      return repos.users.updateRole(targetUserId, role);
    });
  }
}
