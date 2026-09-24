import { Redis } from "ioredis";

export type { Redis };

/** One client per process; shared by rate limiting and job locks. */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3, enableAutoPipelining: true });
}
