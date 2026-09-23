import { Router } from "express";
import { z } from "zod";
import { respond } from "../http/respond.js";
import type { DepartmentService } from "../services/department.service.js";
import { departmentDto } from "./schemas.js";

export const departmentListDto = z.array(departmentDto);

/** Public: the registration form needs the department list before login. */
export function departmentsRouter(departments: DepartmentService): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    respond(res, 200, departmentListDto, await departments.list());
  });

  return router;
}
