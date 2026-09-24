import { DomainError } from "../domain/errors.js";
import type {
  AnalyticsScope,
  AnalyticsWindow,
  HeatmapCell,
  IdleRow,
  NoShowByResource,
  NoShowByUser,
  OutcomeCounts,
  UtilizationRow,
  UtilizationTotals,
} from "../repositories/analytics.repository.js";
import type { UnitOfWork } from "../repositories/index.js";

export type { AnalyticsScope, AnalyticsWindow };

/** §10: a resource needs at least 4 weeks of observation to be ranked as idle. */
export const IDLE_RANKING_MIN_DAYS = 28;

const DAY_MS = 86_400_000;
/** Default window when the caller names none: the last 4 weeks. */
export const DEFAULT_WINDOW_DAYS = 28;
/** Longest window one request may cover (bounds the per-day SQL series). */
export const MAX_WINDOW_DAYS = 366;

/** A requested window; either bound may be omitted. */
export interface RequestedWindow {
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface UtilizationReport {
  window: AnalyticsWindow;
  totals: UtilizationTotals;
  resources: UtilizationRow[];
}

export interface NoShowReport {
  window: AnalyticsWindow;
  overall: OutcomeCounts;
  byUser: NoShowByUser[];
  byResource: NoShowByResource[];
}

export interface HeatmapReport {
  window: AnalyticsWindow;
  cells: HeatmapCell[];
}

export interface IdleExclusion {
  resourceId: string;
  name: string;
  reason: NonNullable<IdleRow["excludedReason"]>;
  observedDays: number;
  message: string;
}

export interface IdleRankingReport {
  window: AnalyticsWindow;
  minimumDays: number;
  ranked: (IdleRow & { rank: number })[];
  excluded: IdleExclusion[];
}

/**
 * Analytics (CLAUDE.md §10). The scope must come from the route's
 * `analytics:view` check. Every figure is computed by SQL in
 * AnalyticsRepository; this layer only settles the window and splits the
 * idle ranking into ranked and excluded resources.
 *
 * Analytics look back: a window reaching past "now" is clipped to now, so
 * hours that haven't happened yet never count as available-but-unused.
 */
export class AnalyticsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async utilization(scope: AnalyticsScope, requested: RequestedWindow): Promise<UtilizationReport> {
    const window = this.effective(requested);
    const [totals, resources] = await Promise.all([
      this.uow.read.analytics.utilizationTotals(scope, window),
      this.uow.read.analytics.utilization(scope, window),
    ]);
    return { window, totals, resources };
  }

  async noShows(scope: AnalyticsScope, requested: RequestedWindow): Promise<NoShowReport> {
    const window = this.effective(requested);
    const [overall, byUser, byResource] = await Promise.all([
      this.uow.read.analytics.noShowOverall(scope, window),
      this.uow.read.analytics.noShowsByUser(scope, window),
      this.uow.read.analytics.noShowsByResource(scope, window),
    ]);
    return { window, overall, byUser, byResource };
  }

  async heatmap(scope: AnalyticsScope, requested: RequestedWindow): Promise<HeatmapReport> {
    const window = this.effective(requested);
    return { window, cells: await this.uow.read.analytics.heatmap(scope, window) };
  }

  /**
   * Resources ordered by utilization, least used first. Resources that can't
   * be ranked fairly are listed under `excluded` with the reason, never
   * silently dropped.
   */
  async idleRanking(scope: AnalyticsScope, requested: RequestedWindow): Promise<IdleRankingReport> {
    const window = this.effective(requested);
    const rows = await this.uow.read.analytics.idleCandidates(scope, window, IDLE_RANKING_MIN_DAYS);
    const ranked = rows.filter((r) => r.excludedReason === null).map((r, i) => ({ ...r, rank: i + 1 }));
    const excluded = rows.flatMap((r) =>
      r.excludedReason === null
        ? []
        : [
            {
              resourceId: r.resourceId,
              name: r.name,
              reason: r.excludedReason,
              observedDays: r.observedDays,
              message: exclusionMessage(r.excludedReason, r.observedDays),
            },
          ],
    );
    return { window, minimumDays: IDLE_RANKING_MIN_DAYS, ranked, excluded };
  }

  /**
   * Defaults: to = now, from = to - 4 weeks. The window must be non-empty, at
   * most MAX_WINDOW_DAYS long, and start in the past; its end is clipped to now.
   */
  private effective(requested: RequestedWindow): AnalyticsWindow {
    const now = this.now();
    const to = requested.to ?? now;
    const from = requested.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
    if (to.getTime() <= from.getTime()) throw new DomainError("VALIDATION_ERROR", "to must be after from");
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
      throw new DomainError("VALIDATION_ERROR", `The window may span at most ${MAX_WINDOW_DAYS} days`);
    }
    if (from.getTime() >= now.getTime()) {
      throw new DomainError("VALIDATION_ERROR", "The analytics window must start in the past");
    }
    return { from, to: to.getTime() > now.getTime() ? now : to };
  }
}

function exclusionMessage(reason: IdleExclusion["reason"], observedDays: number): string {
  switch (reason) {
    case "INACTIVE":
      return "Resource is inactive";
    case "INSUFFICIENT_DATA":
      return `Only ${Math.floor(observedDays * 10) / 10} days of data in this window; at least ${IDLE_RANKING_MIN_DAYS} are needed`;
    case "NO_AVAILABLE_HOURS":
      return "Resource has no business hours in this window";
  }
}
