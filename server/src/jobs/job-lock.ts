import { randomUUID } from "node:crypto";
import type { Redis } from "../lib/redis.js";

/**
 * Cross-instance lock for scheduled jobs (CLAUDE.md §2c): acquire with
 * `SET lock:<job> <run-id> NX PX <ttl>`, release only if the value is still
 * this run's id. The TTL is the crash safety net — a worker that dies while
 * holding the lock stops blocking future runs once it expires.
 */
const RELEASE_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export type LockedRun<T> = { ran: true; runId: string; result: T } | { ran: false };

export function jobLockKey(jobName: string): string {
  return `lock:${jobName}`;
}

export async function withJobLock<T>(
  redis: Redis,
  jobName: string,
  ttlMs: number,
  work: () => Promise<T>,
): Promise<LockedRun<T>> {
  const key = jobLockKey(jobName);
  const runId = randomUUID();
  const acquired = await redis.set(key, runId, "PX", ttlMs, "NX");
  if (acquired !== "OK") return { ran: false };
  try {
    return { ran: true, runId, result: await work() };
  } finally {
    // If this run outlived its TTL and another run took the lock, the value
    // no longer matches and that run's lock is left alone.
    await redis.eval(RELEASE_IF_OWNER, 1, key, runId);
  }
}
