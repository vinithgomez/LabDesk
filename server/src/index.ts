import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createServices } from "./container.js";
import { createPrismaClient } from "./db/prisma.js";
import { createLogger } from "./lib/logger.js";
import { createRedis } from "./lib/redis.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const prisma = createPrismaClient(config.databaseUrl);
const redis = createRedis(config.redisUrl);
const services = createServices(prisma, config);
const app = createApp({ config, logger, services, redis });

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "LabDesk API listening");
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    void Promise.all([prisma.$disconnect(), redis.quit()]).finally(() => process.exit(0));
  });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
