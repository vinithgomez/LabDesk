import { createPasswordHasher } from "./auth/password.js";
import { createTokenSigner } from "./auth/tokens.js";
import type { AppConfig } from "./config/env.js";
import type { PrismaClient } from "./db/prisma.js";
import { createUnitOfWork, type UnitOfWork } from "./repositories/index.js";
import { AuthService } from "./services/auth.service.js";
import { BookingService } from "./services/booking.service.js";
import { CheckinService } from "./services/checkin.service.js";
import { DepartmentService } from "./services/department.service.js";
import { ResourceService } from "./services/resource.service.js";
import { UserService } from "./services/user.service.js";
import { WaitlistService } from "./services/waitlist.service.js";

export interface Services {
  auth: AuthService;
  departments: DepartmentService;
  users: UserService;
  resources: ResourceService;
  bookings: BookingService;
  checkins: CheckinService;
  waitlist: WaitlistService;
}

export interface ServiceOverrides {
  /** Tests substitute a unit of work to inject barriers or faults. */
  uow?: UnitOfWork;
  /** Tests substitute a clock to hit time-window boundaries exactly. */
  clock?: () => Date;
}

/** Wires repositories -> services. The only place that knows the concrete graph. */
export function createServices(prisma: PrismaClient, config: AppConfig, overrides: ServiceOverrides = {}): Services {
  const uow = overrides.uow ?? createUnitOfWork(prisma);
  const clock = overrides.clock ?? (() => new Date());
  const tokens = createTokenSigner({
    accessSecret: config.jwtAccessSecret,
    refreshSecret: config.jwtRefreshSecret,
    accessTtlSeconds: config.accessTokenTtlSeconds,
    refreshTtlSeconds: config.refreshTokenTtlSeconds,
  });
  const passwords = createPasswordHasher(config.bcryptRounds);

  const bookings = new BookingService(uow, clock);

  return {
    auth: new AuthService(uow, passwords, tokens, config.refreshTokenTtlSeconds),
    departments: new DepartmentService(uow),
    users: new UserService(uow),
    resources: new ResourceService(uow),
    bookings,
    checkins: new CheckinService(uow, config.publicAppUrl, clock),
    waitlist: new WaitlistService(uow, bookings, clock),
  };
}
