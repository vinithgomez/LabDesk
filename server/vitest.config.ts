import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One disposable Postgres for the whole run (Testcontainers).
    globalSetup: ["src/test/global-setup.ts"],
    // Integration files share that database and truncate it between tests,
    // so they must not run concurrently.
    fileParallelism: false,
    // Type-level tests (*.test-d.ts) are compiled by tsc as part of `npm test`,
    // so compile-time guarantees (e.g. booking inserts require a transaction)
    // are enforced by the suite, not only by `npm run typecheck`.
    typecheck: {
      enabled: true,
      include: ["src/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
  },
});
