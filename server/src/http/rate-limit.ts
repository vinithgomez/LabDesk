import type { Redis } from "../lib/redis.js";

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts made in the current window, including this one. */
  count: number;
  /** Milliseconds until the window resets. */
  resetInMs: number;
}

export interface RateLimiter {
  hit(key: string): Promise<RateLimitResult>;
}

// Atomic: increment, start the window's expiry on the first hit, report TTL.
const FIXED_WINDOW = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}
`;

/**
 * Fixed-window limiter in Redis: at most `limit` hits per `windowMs` per key.
 * Every hit counts, allowed or not, so hammering past the limit doesn't
 * shorten the wait.
 */
export function createFixedWindowLimiter(
  redis: Redis,
  opts: { prefix: string; limit: number; windowMs: number },
): RateLimiter {
  return {
    async hit(key) {
      const reply = await redis.eval(FIXED_WINDOW, 1, `${opts.prefix}:${key}`, String(opts.windowMs));
      const [count, ttl] = Array.isArray(reply) ? reply.map(Number) : [Number.NaN, Number.NaN];
      if (count === undefined || ttl === undefined || Number.isNaN(count)) {
        throw new Error("Unexpected rate limiter reply from Redis");
      }
      return { allowed: count <= opts.limit, count, resetInMs: ttl > 0 ? ttl : opts.windowMs };
    },
  };
}
