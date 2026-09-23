import { DomainError } from "../domain/errors.js";
import type { Resource, User } from "../domain/types.js";
import type { Repositories, UnitOfWork } from "../repositories/index.js";
import type { ResourceFields, ResourceFilter } from "../repositories/resource.repository.js";

export type { ResourceFields, ResourceFilter };

/**
 * Resource use cases. Authorization has already happened in the route via
 * `can()`; this layer enforces data invariants only.
 */
export class ResourceService {
  constructor(private readonly uow: UnitOfWork) {}

  list(filter: ResourceFilter): Promise<Resource[]> {
    return this.uow.read.resources.list(filter);
  }

  async get(id: string): Promise<Resource> {
    const resource = await this.uow.read.resources.findById(id);
    if (!resource) throw new DomainError("RESOURCE_NOT_FOUND", "Resource not found");
    return resource;
  }

  create(input: { departmentId: string; fields: ResourceFields; ownerIds: string[] }): Promise<Resource> {
    assertSlotBounds(input.fields.minSlotMinutes, input.fields.maxSlotMinutes);
    const ownerIds = [...new Set(input.ownerIds)];

    return this.uow.transaction(async (repos) => {
      const department = await repos.departments.findById(input.departmentId);
      if (!department) throw new DomainError("DEPARTMENT_NOT_FOUND", "Department does not exist");
      await assertEligibleOwners(repos, ownerIds, department.id);
      return repos.resources.create(department.id, input.fields, ownerIds);
    });
  }

  update(id: string, patch: Partial<ResourceFields>): Promise<Resource> {
    return this.uow.transaction(async (repos) => {
      const current = await repos.resources.findById(id);
      if (!current) throw new DomainError("RESOURCE_NOT_FOUND", "Resource not found");
      assertSlotBounds(
        patch.minSlotMinutes ?? current.minSlotMinutes,
        patch.maxSlotMinutes ?? current.maxSlotMinutes,
      );
      return repos.resources.update(id, patch);
    });
  }

  /** Soft delete: bookings (Phase 2+) will reference resources, so rows are never removed. */
  deactivate(id: string): Promise<Resource> {
    return this.update(id, { isActive: false });
  }
}

function assertSlotBounds(min: number, max: number): void {
  if (min > max) {
    throw new DomainError("INVALID_SLOT_BOUNDS", "minSlotMinutes must not exceed maxSlotMinutes");
  }
}

/**
 * Owners approve and manage the resource, so they must be active staff in
 * the resource's department (admins may own resources anywhere).
 */
async function assertEligibleOwners(repos: Repositories, ownerIds: string[], departmentId: string): Promise<void> {
  if (ownerIds.length === 0) return;
  const users = await repos.users.findManyByIds(ownerIds);
  const byId = new Map(users.map((u) => [u.id, u]));
  const problems = ownerIds.flatMap((id) => {
    const reason = ownerIneligibility(byId.get(id), departmentId);
    return reason ? [{ userId: id, reason }] : [];
  });
  if (problems.length > 0) {
    throw new DomainError("INVALID_OWNER", "One or more owners are not eligible", problems);
  }
}

function ownerIneligibility(user: User | undefined, departmentId: string): string | null {
  if (!user) return "user does not exist";
  if (!user.isActive) return "user is inactive";
  if (user.role === "student") return "students cannot own resources";
  if (user.role !== "admin" && user.departmentId !== departmentId) return "user is in another department";
  return null;
}
