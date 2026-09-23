import { isUniqueViolation, type DbClient } from "../db/prisma.js";
import type { User, UserCredentials, UserRole, UserWithDepartment } from "../domain/types.js";

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  departmentId: true,
  rollNo: true,
  isActive: true,
  createdAt: true,
} as const;

export interface NewUser {
  email: string;
  passwordHash: string;
  fullName: string;
  departmentId: string;
  rollNo: string | null;
}

export class UserRepository {
  constructor(private readonly db: DbClient) {}

  findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id }, select: userSelect });
  }

  findByIdWithDepartment(id: string): Promise<UserWithDepartment | null> {
    return this.db.user.findUnique({
      where: { id },
      select: { ...userSelect, department: true },
    });
  }

  findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    return this.db.user.findUnique({
      where: { email },
      select: { ...userSelect, passwordHash: true },
    });
  }

  findManyByIds(ids: string[]): Promise<User[]> {
    return this.db.user.findMany({ where: { id: { in: ids } }, select: userSelect });
  }

  /**
   * Inserts a user. `role` is deliberately not accepted: every new account
   * takes the database default ('student'). Returns null if the email is taken.
   */
  async create(input: NewUser): Promise<User | null> {
    try {
      return await this.db.user.create({ data: input, select: userSelect });
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  updateRole(id: string, role: UserRole): Promise<User> {
    return this.db.user.update({ where: { id }, data: { role }, select: userSelect });
  }
}
