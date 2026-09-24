/** Response shapes of /api/analytics/* (server/src/routes/analytics.routes.ts). */

export interface AnalyticsWindow {
  from: string;
  to: string;
}

export interface AnalyticsScope {
  departmentId: string | null;
  resourceId: string | null;
}

export interface UtilizationMeasures {
  availableMinutes: number;
  bookedMinutes: number;
  /** All checked-in time: inHoursMinutes + offHoursMinutes. */
  actualMinutes: number;
  /** Checked-in time within business hours on business days (the utilization numerator). */
  inHoursMinutes: number;
  /** Checked-in time outside business hours or days; shown, never in the ratio. */
  offHoursMinutes: number;
  autoCompletedMinutes: number;
  bookings: number;
  sessions: number;
  utilization: number | null;
}

export interface UtilizationReport {
  window: AnalyticsWindow;
  scope: AnalyticsScope;
  totals: UtilizationMeasures;
  resources: (UtilizationMeasures & { resourceId: string; name: string; departmentId: string; isActive: boolean })[];
}

export interface OutcomeCounts {
  noShows: number;
  attended: number;
  outcomes: number;
  rate: number | null;
}

export interface NoShowReport {
  window: AnalyticsWindow;
  scope: AnalyticsScope;
  overall: OutcomeCounts;
  byUser: (OutcomeCounts & { userId: string; fullName: string; rollNo: string | null })[];
  byResource: (OutcomeCounts & { resourceId: string; name: string })[];
}

export interface HeatmapCell {
  /** IST, 0 = Sunday. */
  dow: number;
  hour: number;
  bookedMinutes: number;
  bookings: number;
}

export interface HeatmapReport {
  window: AnalyticsWindow;
  scope: AnalyticsScope;
  timezone: string;
  cells: HeatmapCell[];
}

export interface IdleRankingReport {
  window: AnalyticsWindow;
  scope: AnalyticsScope;
  minimumDays: number;
  ranked: {
    rank: number;
    resourceId: string;
    name: string;
    utilization: number | null;
    availableMinutes: number;
    bookedMinutes: number;
    actualMinutes: number;
    inHoursMinutes: number;
    offHoursMinutes: number;
    observedDays: number;
  }[];
  excluded: {
    resourceId: string;
    name: string;
    reason: "INACTIVE" | "INSUFFICIENT_DATA" | "NO_AVAILABLE_HOURS";
    observedDays: number;
    message: string;
  }[];
}

export interface Department {
  id: string;
  name: string;
  code: string;
}
