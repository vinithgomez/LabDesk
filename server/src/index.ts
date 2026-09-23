import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createServices } from "./container.js";
import { createPrismaClient } from "./db/prisma.js";
import { createLogger } from "./lib/logger.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const prisma = createPrismaClient(config.databaseUrl);
const app = createApp({ config, logger, services: createServices(prisma, config) });

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "LabDesk API listening");
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
