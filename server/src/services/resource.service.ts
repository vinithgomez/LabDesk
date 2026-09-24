import { assertApprovalLevelsCovered, assertOwnerLevelsInRange } from "../domain/approvals.js";
import { DomainError, resourceNotFound } from "../domain/errors.js";
import type { Actor, Resource, ResourceOwner, User } from "../domain/types.js";
import type { Repositories, UnitOfWork } from "../repositories/index.js";
import type { ResourceFields, ResourceFilter } from "../repositories/resource.repository.js";

export type { ResourceFields, ResourceFilter };

/**
 * Resource use cases. Authorization has already happened in the route via
 * `can()`; this layer enforces data invariants only.
 *
 * Owner invariant, checked on create, on every update and on owner
 * replacement: owners are eligible (see `ownerIneligibility`), sit at a level
 * the resource uses, and — if the resource requires approval — every required
 * level keeps at least one owner. Otherwise pending bookings could become
 * undecidable by anyone but an admin.
 */
export class ResourceService {
  constructor(private readonly uow: UnitOfWork) {}

  list(filter: ResourceFilter): Promise<Resource[]> {
    return this.uow.read.resources.list(filter);
  }

  async get(id: string): Promise<Resource> {
    const resource = await this.uow.read.resources.findById(id);
    if (!resource) throw resourceNotFound();
    return resource;
  }

  create(
    actor: Actor,
    input: { departmentId: string; fields: ResourceFields; owners: ResourceOwner[] },
  ): Promise<Resource> {
    assertSlotBounds(input.fields.minSlotMinutes, input.fields.maxSlotMinutes);
    assertBusinessHours(input.fields.businessHoursStart, input.fields.businessHoursEnd);
    assertUniqueOwners(input.owners);

    return this.uow.transaction(async (tx) => {
      const department = await tx.departments.findById(input.departmentId);
      if (!department) throw new DomainError("DEPARTMENT_NOT_FOUND", "Department does not exist");
      await assertValidOwners(tx, input.fields, input.owners, department.id);

      const created = await tx.resources.create(department.id, input.fields, input.owners);
      await tx.writeAudit({
        actorId: actor.id,
        entityType: "resource",
        entityId: created.id,
        action: "resource.created",
        before: null,
        after: created,
      });
      return created;
    });
  }

  update(actor: Actor, id: string, patch: Partial<ResourceFields>): Promise<Resource> {
    return this.applyChange(actor, id, patch, "resource.updated");
  }

  /** Soft delete: bookings (Phase 2+) will reference resources, so rows are never removed. */
  deactivate(actor: Actor, id: string): Promise<Resource> {
    return this.applyChange(actor, id, { isActive: false }, "resource.deactivated");
  }

  /**
   * Replaces the resource's owners (and their approval levels) wholesale.
   * Callers must have passed `can(actor, "resource:manage_owners", ...)`.
   */
  replaceOwners(actor: Actor, id: string, owners: ResourceOwner[]): Promise<Resource> {
    assertUniqueOwners(owners);
    return this.uow.transaction(async (tx) => {
      await tx.resources.lockById(id);
      const before = await tx.resources.findById(id);
      if (!before) throw resourceNotFound();
      await assertValidOwners(tx, before, owners, before.departmentId);

      const after = await tx.resources.replaceOwners(id, owners);
      await tx.writeAudit({
        actorId: actor.id,
        entityType: "resource",
        entityId: id,
        action: "resource.owners_changed",
        before,
        after,
      });
      return after;
    });
  }

  private applyChange(
    actor: Actor,
    id: string,
    patch: Partial<ResourceFields>,
    action: "resource.updated" | "resource.deactivated",
  ): Promise<Resource> {
    return this.uow.transaction(async (tx) => {
      await tx.resources.lockById(id);
      const before = await tx.resources.findById(id);
      if (!before) throw resourceNotFound();
      const merged = { ...before, ...patch };
      assertSlotBounds(merged.minSlotMinutes, merged.maxSlotMinutes);
      assertBusinessHours(merged.businessHoursStart, merged.businessHoursEnd);
      // Approval settings can't be changed into a state the current owners
      // can't serve (e.g. requiring approval with no owners, or a second
      // level nobody owns).
      assertOwnerLevelsInRange(merged, before.owners);
      assertApprovalLevelsCovered(merged, before.owners);

      const after = await tx.resources.update(id, patch);
      await tx.writeAudit({ actorId: actor.id, entityType: "resource", entityId: id, action, before, after });
      return after;
    });
  }
}

/** "HH:MM" strings compare correctly as text. The DB CHECK is the backstop. */
function assertBusinessHours(start: string, end: string): void {
  if (start >= end) {
    throw new DomainError("INVALID_BUSINESS_HOURS", "businessHoursStart must be before businessHoursEnd");
  }
}

function assertSlotBounds(min: number, max: number): void {
  if (min > max) {
    throw new DomainError("INVALID_SLOT_BOUNDS", "minSlotMinutes must not exceed maxSlotMinutes");
  }
}

function assertUniqueOwners(owners: readonly ResourceOwner[]): void {
  const ids = owners.map((o) => o.userId);
  if (new Set(ids).size !== ids.length) {
    throw new DomainError("INVALID_OWNER", "Each user may appear only once in the owner list");
  }
}

async function assertValidOwners(
  repos: Repositories,
  config: Pick<Resource, "requiresApproval" | "approvalLevels">,
  owners: readonly ResourceOwner[],
  departmentId: string,
): Promise<void> {
  assertOwnerLevelsInRange(config, owners);
  await assertEligibleOwners(
    repos,
    owners.map((o) => o.userId),
    departmentId,
  );
  assertApprovalLevelsCovered(config, owners);
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
