import type { Express } from "express";
import request from "supertest";
import { inject } from "vitest";
import { createApp } from "../app.js";
import type { AppConfig } from "../config/env.js";
import { createServices, type Services } from "../container.js";
import { createPrismaClient, type PrismaClient } from "../db/prisma.js";
import type { UserRole } from "../domain/types.js";
import { createLogger } from "../lib/logger.js";
import { createRedis, type Redis } from "../lib/redis.js";

export interface TestHarness {
  app: Express;
  prisma: PrismaClient;
  redis: Redis;
  services: Services;
  close(): Promise<void>;
}

/** A clock tests can move: pass `clock.now` to createHarness, then `clock.set(...)`. */
export interface TestClock {
  now: () => Date;
  set(at: Date): void;
}

export function createTestClock(initial: Date = new Date()): TestClock {
  let current = new Date(initial);
  return { now: () => new Date(current), set: (at) => (current = new Date(at)) };
}

export function createHarness(opts: { clock?: () => Date } = {}): TestHarness {
  const databaseUrl = inject("databaseUrl");
  const config = testConfig(databaseUrl);
  const prisma = createPrismaClient(databaseUrl);
  const redis = createRedis(inject("redisUrl"));
  const services = createServices(prisma, config, opts.clock ? { clock: opts.clock } : {});
  const app = createApp({ config, logger: createLogger("silent"), services, redis });
  return {
    app,
    prisma,
    redis,
    services,
    close: async () => {
      await Promise.all([prisma.$disconnect(), redis.quit()]);
    },
  };
}

export function testConfig(databaseUrl: string): AppConfig {
  return {
    nodeEnv: "test",
    port: 0,
    databaseUrl,
    jwtAccessSecret: "test-access-secret-0123456789",
    jwtRefreshSecret: "test-refresh-secret-0123456789",
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlSeconds: 7 * 86_400,
    corsOrigin: "http://localhost:5173",
    bcryptRounds: 4,
    logLevel: "silent",
    redisUrl: inject("redisUrl"),
    publicAppUrl: "https://labdesk.test",
    jobsEnabled: false,
  };
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_log", "waitlist_entries", "booking_series_skips", "checkins", "booking_approvals", "bookings", "booking_series", "maintenance_windows", "refresh_tokens", "resource_owners", "resources", "users", "departments" RESTART IDENTITY CASCADE',
  );
}

export async function createDepartment(prisma: PrismaClient, code: string): Promise<string> {
  const row = await prisma.department.create({ data: { code, name: `Department ${code}` } });
  return row.id;
}

export interface TestUser {
  id: string;
  token: string;
  auth: { Authorization: string };
}

/**
 * Registers through the public API (so every user starts exactly as a real
 * signup does), then sets the role directly in the DB to arrange fixtures.
 */
export async function registerUser(
  h: TestHarness,
  opts: { email: string; departmentId: string; role?: UserRole },
): Promise<TestUser> {
  const res = await request(h.app)
    .post("/api/auth/register")
    .send({ email: opts.email, password: "correct-horse-battery", fullName: opts.email, departmentId: opts.departmentId });
  if (res.status !== 201) {
    throw new Error(`registration failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const body = res.body as { data: { accessToken: string; user: { id: string } } };
  if (opts.role && opts.role !== "student") {
    await h.prisma.user.update({ where: { id: body.data.user.id }, data: { role: opts.role } });
  }
  return {
    id: body.data.user.id,
    token: body.data.accessToken,
    auth: { Authorization: `Bearer ${body.data.accessToken}` },
  };
}

export interface ResourceFixture {
  departmentId: string;
  name?: string;
  /** Level-1 owners (shorthand). */
  ownerIds?: string[];
  /** Owners with explicit approval levels. */
  owners?: { userId: string; approvalLevel: number }[];
  requiresApproval?: boolean;
  approvalLevels?: number;
  isActive?: boolean;
  capacity?: number;
  minSlotMinutes?: number;
  maxSlotMinutes?: number;
  bookingHorizonDays?: number;
  /** IST "HH:MM"; defaults to the schema's 08:00–18:00. */
  businessHoursStart?: string;
  businessHoursEnd?: string;
  /** 0 = Sunday; defaults to Monday–Friday. */
  businessDays?: number[];
  /** Backdates the resource (analytics measures observation from here). */
  createdAt?: Date;
}

/** Creates a resource directly. Defaults: capacity 30, 30–120 minute slots, 7-day horizon. */
export async function createResource(prisma: PrismaClient, f: ResourceFixture): Promise<string> {
  const row = await prisma.resource.create({
    data: {
      departmentId: f.departmentId,
      name: f.name ?? "Test Lab",
      type: "lab",
      location: "Block A",
      capacity: f.capacity ?? 30,
      minSlotMinutes: f.minSlotMinutes ?? 30,
      maxSlotMinutes: f.maxSlotMinutes ?? 120,
      bookingHorizonDays: f.bookingHorizonDays ?? 7,
      ...(f.businessHoursStart && { businessHoursStart: new Date(`1970-01-01T${f.businessHoursStart}:00.000Z`) }),
      ...(f.businessHoursEnd && { businessHoursEnd: new Date(`1970-01-01T${f.businessHoursEnd}:00.000Z`) }),
      ...(f.businessDays && { businessDays: f.businessDays }),
      ...(f.createdAt && { createdAt: f.createdAt }),
      isActive: f.isActive ?? true,
      requiresApproval: f.requiresApproval ?? false,
      approvalLevels: f.approvalLevels ?? 1,
      owners: {
        create: [
          ...(f.ownerIds ?? []).map((userId) => ({ userId, approvalLevel: 1 })),
          ...(f.owners ?? []),
        ],
      },
    },
  });
  return row.id;
}

/**
 * A slot on the IST calendar `daysAhead` days from today, as ISO strings with
 * an explicit +05:30 offset. `endDaysAhead` lets a slot cross midnight.
 */
export function istSlot(
  daysAhead: number,
  startHHMM: string,
  endHHMM: string,
  endDaysAhead: number = daysAhead,
): { start: string; end: string } {
  const istDay = (d: number): string =>
    new Date(Date.now() + d * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
  return {
    start: `${istDay(daysAhead)}T${startHHMM}:00+05:30`,
    end: `${istDay(endDaysAhead)}T${endHHMM}:00+05:30`,
  };
}

let keyCounter = 0;

/** POST /api/bookings with a fresh Idempotency-Key unless one is given. */
export function book(
  h: TestHarness,
  user: TestUser,
  body: Record<string, unknown>,
  idempotencyKey: string = `test-key-${Date.now()}-${(keyCounter += 1)}`,
): request.Test {
  return request(h.app).post("/api/bookings").set(user.auth).set("Idempotency-Key", idempotencyKey).send(body);
}

export async function createMaintenanceWindow(
  prisma: PrismaClient,
  w: { resourceId: string; start: string; end: string; createdBy: string },
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO maintenance_windows (resource_id, period, reason, created_by)
    VALUES (${w.resourceId}::uuid, tstzrange(${w.start}::timestamptz, ${w.end}::timestamptz, '[)'), 'test', ${w.createdBy}::uuid)`;
}

/** Clears rate-limit counters and job locks between tests. */
export async function resetRedis(redis: Redis): Promise<void> {
  await redis.flushdb();
}

/**
 * Inserts a booking directly, at any time and in any status, so tests can
 * place periods relative to a test clock (the API refuses past starts).
 */
export async function insertBooking(
  prisma: PrismaClient,
  b: { resourceId: string; userId: string; start: Date; end: Date; status: string },
): Promise<string> {
  const [row] = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO bookings (resource_id, user_id, period, status)
    VALUES (
      ${b.resourceId}::uuid,
      ${b.userId}::uuid,
      tstzrange(${b.start.toISOString()}::timestamptz, ${b.end.toISOString()}::timestamptz, '[)'),
      ${b.status}::booking_status
    )
    RETURNING id::text AS id`;
  if (!row) throw new Error("insertBooking returned no row");
  return row.id;
}


/** Inserts a check-in row directly; `out` null leaves the session open. */
export async function insertCheckin(
  prisma: PrismaClient,
  c: { bookingId: string; in: Date; out: Date | null; checkoutMethod?: "qr" | "manual_override" | "auto" },
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO checkins (booking_id, checked_in_at, checked_out_at, checkin_method, checkout_method)
    VALUES (
      ${c.bookingId}::uuid,
      ${c.in.toISOString()}::timestamptz,
      ${c.out?.toISOString() ?? null}::timestamptz,
      'qr',
      ${c.out ? (c.checkoutMethod ?? "qr") : null}::checkout_method
    )`;
}
