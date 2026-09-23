import { createPasswordHasher } from "./auth/password.js";
import { createTokenSigner } from "./auth/tokens.js";
import type { AppConfig } from "./config/env.js";
import type { PrismaClient } from "./db/prisma.js";
import { createUnitOfWork } from "./repositories/index.js";
import { AuthService } from "./services/auth.service.js";
import { DepartmentService } from "./services/department.service.js";

export interface Services {
  auth: AuthService;
  departments: DepartmentService;
}

/** Wires repositories -> services. The only place that knows the concrete graph. */
export function createServices(prisma: PrismaClient, config: AppConfig): Services {
  const uow = createUnitOfWork(prisma);
  const tokens = createTokenSigner({
    accessSecret: config.jwtAccessSecret,
    refreshSecret: config.jwtRefreshSecret,
    accessTtlSeconds: config.accessTokenTtlSeconds,
    refreshTtlSeconds: config.refreshTokenTtlSeconds,
  });
  const passwords = createPasswordHasher(config.bcryptRounds);

  return {
    auth: new AuthService(uow, passwords, tokens, config.refreshTokenTtlSeconds),
    departments: new DepartmentService(uow),
  };
}
