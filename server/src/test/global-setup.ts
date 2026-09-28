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
 *
 * CI instead provides both as service containers: when TEST_DATABASE_URL
 * and TEST_REDIS_URL are set, those are used (still a real PostgreSQL and
 * Redis, migrated the same way) and nothing is started here.
 */
export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  const external = externalServices();
  if (external) {
    migrate(external.databaseUrl);
    provide("databaseUrl", external.databaseUrl);
    provide("redisUrl", external.redisUrl);
    return async () => undefined;
  }

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
  migrate(databaseUrl);

  provide("databaseUrl", databaseUrl);
  provide("redisUrl", redis.getConnectionUrl());
  return async () => {
    await Promise.all([container.stop(), redis.stop()]);
  };
}

function migrate(databaseUrl: string): void {
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}

/**
 * Externally provided test services, if any. The tests truncate every table,
 * so an external database must be named *_test: a mistyped URL can never
 * point them at a real database.
 */
function externalServices(): { databaseUrl: string; redisUrl: string } | null {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const redisUrl = process.env.TEST_REDIS_URL;
  if (!databaseUrl && !redisUrl) return null;
  if (!databaseUrl || !redisUrl) throw new Error("Set both TEST_DATABASE_URL and TEST_REDIS_URL, or neither");
  const database = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to run tests against database "${database}": its name must end in _test`);
  }
  return { databaseUrl, redisUrl };
}
