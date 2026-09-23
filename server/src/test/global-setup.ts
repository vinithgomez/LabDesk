import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { GlobalSetupContext } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Starts a disposable PostgreSQL 16 (same major as docker-compose and prod)
 * and applies the real migrations, so tests exercise the actual schema,
 * extensions and constraints. Never a mock or SQLite (CLAUDE.md §2.5).
 */
export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("labdesk_test")
    .withUsername("labdesk")
    .withPassword("labdesk")
    .start();

  const databaseUrl = `${container.getConnectionUri()}?schema=public`;
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  provide("databaseUrl", databaseUrl);
  return async () => {
    await container.stop();
  };
}
