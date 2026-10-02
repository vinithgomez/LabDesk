import { isUniqueViolation, type DbClient } from "../db/prisma.js";
import type { TxClient } from "../db/transaction.js";
import type { User, UserCredentials, UserRole, UserSearch, UserSummary, UserWithDepartment } from "../domain/types.js";

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

/** Only what a listing may show (UserSummary); never the password hash or feed version. */
const summarySelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  departmentId: true,
  isActive: true,
} as const;

export interface NewUser {
  email: string;
  passwordHash: string;
  fullName: string;
  departmentId: string;
  rollNo: string | null;
}

/** Read-only user queries. Safe on any client, so this is what `uow.read.users` exposes. */
export class UserReader {
  constructor(protected readonly db: DbClient) {}

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

  /** The user's calendar-feed version (null if no such user). */
  async findFeedVersion(id: string): Promise<number | null> {
    const row = await this.db.user.findUnique({ where: { id }, select: { icsFeedVersion: true } });
    return row?.icsFeedVersion ?? null;
  }

  findManyByIds(ids: string[]): Promise<User[]> {
    return this.db.user.findMany({ where: { id: { in: ids } }, select: userSelect });
  }

  /** A filtered, name-ordered page of users. The caller sets the department scope and cap. */
  search(filter: UserSearch): Promise<UserSummary[]> {
    return this.db.user.findMany({
      where: {
        ...(filter.departmentId !== null ? { departmentId: filter.departmentId } : {}),
        ...(filter.role ? { role: filter.role } : {}),
        ...(filter.activeOnly ? { isActive: true } : {}),
        ...(filter.q ? { fullName: { contains: filter.q, mode: "insensitive" as const } } : {}),
      },
      select: summarySelect,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: filter.limit,
    });
  }
}

/**
 * User writes. The constructor accepts only a TxClient: `lockById` takes a
 * row lock that would be released immediately outside a transaction, and
 * `updateRole` must commit together with its audit row.
 */
export class UserWriter extends UserReader {
  constructor(private readonly tx: TxClient) {
    super(tx);
  }

  /**
   * Inserts a user. `role` is deliberately not accepted: every new account
   * takes the database default ('student'). Returns null if the email is
   * taken — the unique violation has then aborted the transaction, so the
   * caller must end it (throw) rather than issue further statements.
   */
  async create(input: NewUser): Promise<User | null> {
    try {
      return await this.tx.user.create({ data: input, select: userSelect });
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  /**
   * Row-locks a user for the rest of the current transaction, so the state
   * read next (e.g. an audit "before" snapshot) cannot change underneath it.
   */
  async lockById(id: string): Promise<void> {
    await this.tx.$executeRaw`SELECT 1 FROM "users" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }

  /** Revokes every earlier calendar-feed URL; returns the new version. */
  async bumpFeedVersion(id: string): Promise<number> {
    const row = await this.tx.user.update({
      where: { id },
      data: { icsFeedVersion: { increment: 1 } },
      select: { icsFeedVersion: true },
    });
    return row.icsFeedVersion;
  }

  updateRole(id: string, role: UserRole): Promise<User> {
    return this.tx.user.update({ where: { id }, data: { role }, select: userSelect });
  }
}
