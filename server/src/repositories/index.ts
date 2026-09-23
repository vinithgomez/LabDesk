import type { DbClient, PrismaClient } from "../db/prisma.js";
import { DepartmentRepository } from "./department.repository.js";
import { RefreshTokenRepository } from "./refresh-token.repository.js";
import { ResourceRepository } from "./resource.repository.js";
import { UserRepository } from "./user.repository.js";

export interface Repositories {
  departments: DepartmentRepository;
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  resources: ResourceRepository;
}

export function createRepositories(db: DbClient): Repositories {
  return {
    departments: new DepartmentRepository(db),
    users: new UserRepository(db),
    refreshTokens: new RefreshTokenRepository(db),
    resources: new ResourceRepository(db),
  };
}

/**
 * The only way services reach the database. `read` uses the root client;
 * `transaction` gives one Prisma transaction per mutation, with every
 * repository bound to it.
 */
export interface UnitOfWork {
  read: Repositories;
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}

export function createUnitOfWork(prisma: PrismaClient): UnitOfWork {
  return {
    read: createRepositories(prisma),
    transaction: (work) => prisma.$transaction((tx) => work(createRepositories(tx))),
  };
}
