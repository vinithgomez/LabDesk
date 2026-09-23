import { z } from "zod";
import { USER_ROLES } from "../domain/types.js";
import { isoDateTime } from "../http/respond.js";

/** Response DTOs shared by several routers. */
export const departmentDto = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
});

export const userDto = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(USER_ROLES),
  departmentId: z.string(),
  rollNo: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: isoDateTime,
});

export const userWithDepartmentDto = userDto.extend({ department: departmentDto });

export const idParams = z.object({ id: z.uuid() });

export type DepartmentDto = z.output<typeof departmentDto>;
export type UserDto = z.output<typeof userDto>;
export type UserWithDepartmentDto = z.output<typeof userWithDepartmentDto>;
