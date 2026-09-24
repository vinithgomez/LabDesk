import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { parse } from "dotenv";
import type { GlobalSetupContext } from "vitest/node";
import { z } from "zod";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

/**
 * Credentials for the disposable test database. Real environment variables
 * win (CI sets them directly); otherwise they come from server/.env. The file
 * is parsed, not loaded into process.env, so the dev DATABASE_URL never
 * reaches test workers.
 */
function testDatabaseCredentials(): { user: string; password: string; database: string } {
  const fromFile = existsSync(".env") ? parse(readFileSync(".env")) : {};
  const env = z
    .object({
      POSTGRES_USER: z.string().min(1),
      POSTGRES_PASSWORD: z.string().min(1),
      POSTGRES_DB: z.string().min(1),
    })
    .safeParse({ ...fromFile, ...process.env });
  if (!env.success) {
    const missing = env.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Test database credentials missing (${missing}): set them in server/.env or the environment`);
  }
  return {
    user: env.data.POSTGRES_USER,
    password: env.data.POSTGRES_PASSWORD,
    database: `${env.data.POSTGRES_DB}_test`,
  };
}

/**
 * Starts a disposable PostgreSQL 16 (same major as docker-compose and prod)
 * and applies the real migrations, so tests exercise the actual schema,
 * extensions and constraints. Never a mock or SQLite (CLAUDE.md §2.5).
 * Also a disposable Redis 7 for rate limiting and job locks.
 */
export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  const credentials = testDatabaseCredentials();
  const [container, redis]: [StartedPostgreSqlContainer, StartedRedisContainer] = await Promise.all([
    new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase(credentials.database)
      .withUsername(credentials.user)
      .withPassword(credentials.password)
      .start(),
    new RedisContainer("redis:7-alpine").start(),
  ]);

  const databaseUrl = `${container.getConnectionUri()}?schema=public`;
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  provide("databaseUrl", databaseUrl);
  provide("redisUrl", redis.getConnectionUrl());
  return async () => {
    await Promise.all([container.stop(), redis.stop()]);
  };
}
