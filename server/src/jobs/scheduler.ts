import cron, { type ScheduledTask } from "node-cron";
import type { Logger } from "../lib/logger.js";
import type { Redis } from "../lib/redis.js";
import type { BookingService } from "../services/booking.service.js";
import type { WaitlistService } from "../services/waitlist.service.js";
import { withJobLock, type LockedRun } from "./job-lock.js";

/** The services scheduled jobs run against. */
export interface JobServices {
  bookings: BookingService;
  waitlist: WaitlistService;
}

/** A run's counters, logged as-is. */
export type JobSummary = Readonly<Record<string, number>>;

export interface JobDefinition {
  /** Also the Redis lock key suffix: lock:<name>. */
  name: string;
  cron: string;
  /**
   * Lock TTL. Comfortably above the expected run time, and below the
   * interval, so a crashed holder never costs more than the next tick.
   */
  ttlMs: number;
  run(services: JobServices): Promise<JobSummary>;
}

export const JOBS: readonly JobDefinition[] = [
  {
    name: "no-show-sweeper",
    cron: "*/5 * * * *",
    ttlMs: 2 * 60_000,
    run: (s) => s.bookings.runNoShowSweep(),
  },
  {
    name: "auto-complete",
    cron: "*/15 * * * *",
    ttlMs: 5 * 60_000,
    run: (s) => s.bookings.runAutoComplete(),
  },
  {
    name: "expire-lapsed-pending",
    cron: "*/5 * * * *",
    ttlMs: 2 * 60_000,
    run: (s) => s.bookings.runLapsedPendingExpiry(),
  },
  {
    name: "waitlist-promoter",
    cron: "*/5 * * * *",
    ttlMs: 2 * 60_000,
    run: (s) => s.waitlist.runPromotion(),
  },
  {
    // A companion to the promoter rather than part of it: the two never
    // compete for an entry (promotion needs start > now, expiry start <= now).
    name: "waitlist-expiry",
    cron: "*/5 * * * *",
    ttlMs: 2 * 60_000,
    run: (s) => s.waitlist.runExpiry(),
  },
];

/** One locked execution of a job: runs only if no other instance holds its lock. */
export function runLockedJob(
  redis: Redis,
  job: JobDefinition,
  services: JobServices,
): Promise<LockedRun<JobSummary>> {
  return withJobLock(redis, job.name, job.ttlMs, () => job.run(services));
}

/**
 * Schedules every job with node-cron. `noOverlap` stops a slow run from
 * overlapping itself within this process; the Redis lock stops it across
 * processes. Returns a stop function for graceful shutdown.
 */
export function startScheduler(deps: { redis: Redis; services: JobServices; logger: Logger }): () => Promise<void> {
  const tasks: ScheduledTask[] = JOBS.map((job) =>
    cron.schedule(
      job.cron,
      async () => {
        try {
          const outcome = await runLockedJob(deps.redis, job, deps.services);
          if (outcome.ran) deps.logger.info({ job: job.name, ...outcome.result }, "job finished");
          else deps.logger.debug({ job: job.name }, "job skipped: lock held elsewhere");
        } catch (err) {
          deps.logger.error({ job: job.name, err }, "job failed");
        }
      },
      { name: job.name, noOverlap: true },
    ),
  );
  return async () => {
    await Promise.all(tasks.map((t) => t.stop()));
  };
}
