import type { DbClient, Prisma } from "../db/prisma.js";
import type { TxClient } from "../db/transaction.js";
import type { Resource, ResourceOwner, ResourceType } from "../domain/types.js";

// qr_secret is intentionally never selected here; only the (Phase 4) QR
// service will read it, through a dedicated method.
const resourceSelect = {
  id: true,
  departmentId: true,
  name: true,
  type: true,
  location: true,
  capacity: true,
  description: true,
  requiresApproval: true,
  approvalLevels: true,
  minSlotMinutes: true,
  maxSlotMinutes: true,
  bookingHorizonDays: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  owners: { select: { userId: true, approvalLevel: true }, orderBy: [{ approvalLevel: "asc" }, { userId: "asc" }] },
} satisfies Prisma.ResourceSelect;

type ResourceRow = Omit<Resource, "ownerIds">;

function toResource(row: ResourceRow): Resource {
  return { ...row, ownerIds: row.owners.map((o) => o.userId) };
}

export interface ResourceFields {
  name: string;
  type: ResourceType;
  location: string;
  capacity: number;
  description: string;
  requiresApproval: boolean;
  approvalLevels: number;
  minSlotMinutes: number;
  maxSlotMinutes: number;
  bookingHorizonDays: number;
  isActive: boolean;
}

export interface ResourceFilter {
  /** null = all departments (already authorized by the caller). */
  departmentId: string | null;
  type?: ResourceType | undefined;
  q?: string | undefined;
  isActive?: boolean | undefined;
}

/** Read-only resource queries. Safe on any client, so this is what `uow.read.resources` exposes. */
export class ResourceReader {
  constructor(protected readonly db: DbClient) {}

  async findById(id: string): Promise<Resource | null> {
    const row = await this.db.resource.findUnique({ where: { id }, select: resourceSelect });
    return row ? toResource(row) : null;
  }

  async findManyByIds(ids: readonly string[]): Promise<Resource[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.resource.findMany({ where: { id: { in: [...ids] } }, select: resourceSelect });
    return rows.map(toResource);
  }

  async list(filter: ResourceFilter): Promise<Resource[]> {
    const q = filter.q?.trim();
    const rows = await this.db.resource.findMany({
      where: {
        ...(filter.departmentId !== null && { departmentId: filter.departmentId }),
        ...(filter.type && { type: filter.type }),
        ...(filter.isActive !== undefined && { isActive: filter.isActive }),
        ...(q && {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { location: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: resourceSelect,
    });
    return rows.map(toResource);
  }
}

/**
 * Resource writes. The constructor accepts only a TxClient: `lockById` and
 * `lockForShare` take row locks that would be released immediately outside a
 * transaction, and `create` / `update` must commit together with their audit
 * row.
 */
export class ResourceWriter extends ResourceReader {
  constructor(private readonly tx: TxClient) {
    super(tx);
  }

  async create(departmentId: string, fields: ResourceFields, owners: readonly ResourceOwner[]): Promise<Resource> {
    const row = await this.tx.resource.create({
      data: {
        ...fields,
        departmentId,
        owners: { create: owners.map((o) => ({ userId: o.userId, approvalLevel: o.approvalLevel })) },
      },
      select: resourceSelect,
    });
    return toResource(row);
  }

  /**
   * Row-locks a resource for the rest of the current transaction, so the
   * state read next (e.g. an audit "before" snapshot) cannot change underneath it.
   */
  async lockById(id: string): Promise<void> {
    await this.tx.$executeRaw`SELECT 1 FROM "resources" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }

  /**
   * Takes a SHARE row lock for the rest of the transaction. Concurrent
   * bookings share it freely; anything that changes whether a resource is
   * bookable (deactivation, maintenance windows) takes FOR UPDATE and so
   * serializes against in-flight bookings.
   */
  async lockForShare(id: string): Promise<void> {
    await this.tx.$executeRaw`SELECT 1 FROM "resources" WHERE "id" = ${id}::uuid FOR SHARE`;
  }

/**
   * Replaces the owner set. resource_owners rows are not referenced by
   * bookings or approvals (those point at users), so replacing them loses no
   * history; the change itself is recorded in the audit log by the caller.
   */
  async replaceOwners(resourceId: string, owners: readonly ResourceOwner[]): Promise<Resource> {
    await this.tx.resourceOwner.deleteMany({ where: { resourceId } });
    await this.tx.resourceOwner.createMany({
      data: owners.map((o) => ({ resourceId, userId: o.userId, approvalLevel: o.approvalLevel })),
    });
    const row = await this.tx.resource.findUniqueOrThrow({ where: { id: resourceId }, select: resourceSelect });
    return toResource(row);
  }

  async update(id: string, patch: Partial<ResourceFields>): Promise<Resource> {
    const row = await this.tx.resource.update({ where: { id }, data: patch, select: resourceSelect });
    return toResource(row);
  }
}
