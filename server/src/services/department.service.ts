import type { Department } from "../domain/types.js";
import type { UnitOfWork } from "../repositories/index.js";

export class DepartmentService {
  constructor(private readonly uow: UnitOfWork) {}

  list(): Promise<Department[]> {
    return this.uow.read.departments.list();
  }
}
