import type { DbClient } from "../db/prisma.js";
import type { Resource, ResourceType } from "../domain/types.js";

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
  owners: { select: { userId: true } },
} as const;

type ResourceRow = Omit<Resource, "ownerIds"> & { owners: { userId: string }[] };

function toResource({ owners, ...row }: ResourceRow): Resource {
  return { ...row, ownerIds: owners.map((o) => o.userId) };
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

export class ResourceRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<Resource | null> {
    const row = await this.db.resource.findUnique({ where: { id }, select: resourceSelect });
    return row ? toResource(row) : null;
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

  async create(departmentId: string, fields: ResourceFields, ownerIds: string[]): Promise<Resource> {
    const row = await this.db.resource.create({
      data: {
        ...fields,
        departmentId,
        owners: { create: ownerIds.map((userId) => ({ userId })) },
      },
      select: resourceSelect,
    });
    return toResource(row);
  }

  async update(id: string, patch: Partial<ResourceFields>): Promise<Resource> {
    const row = await this.db.resource.update({ where: { id }, data: patch, select: resourceSelect });
    return toResource(row);
  }
}
