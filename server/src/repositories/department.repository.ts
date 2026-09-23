import type { DbClient } from "../db/prisma.js";
import type { Department } from "../domain/types.js";

export class DepartmentRepository {
  constructor(private readonly db: DbClient) {}

  findById(id: string): Promise<Department | null> {
    return this.db.department.findUnique({ where: { id } });
  }

  list(): Promise<Department[]> {
    return this.db.department.findMany({ orderBy: { code: "asc" } });
  }
}
