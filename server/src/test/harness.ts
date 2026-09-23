import type { Express } from "express";
import request from "supertest";
import { inject } from "vitest";
import { createApp } from "../app.js";
import type { AppConfig } from "../config/env.js";
import { createServices } from "../container.js";
import { createPrismaClient, type PrismaClient } from "../db/prisma.js";
import type { UserRole } from "../domain/types.js";
import { createLogger } from "../lib/logger.js";

export interface TestHarness {
  app: Express;
  prisma: PrismaClient;
  close(): Promise<void>;
}

export function createHarness(): TestHarness {
  const databaseUrl = inject("databaseUrl");
  const config = testConfig(databaseUrl);
  const prisma = createPrismaClient(databaseUrl);
  const app = createApp({ config, logger: createLogger("silent"), services: createServices(prisma, config) });
  return { app, prisma, close: () => prisma.$disconnect() };
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
  };
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_log", "bookings", "refresh_tokens", "resource_owners", "resources", "users", "departments" RESTART IDENTITY CASCADE',
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
