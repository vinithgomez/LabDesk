/** Display formatting for analytics figures. */

export function percent(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${(ratio * 100).toFixed(ratio > 0 && ratio < 0.1 ? 1 : 0)}%`;
}

export function hours(minutes: number): string {
  const h = minutes / 60;
  if (h === 0) return "0 h";
  return `${h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString()} h`;
}

export function days(n: number): string {
  const d = Math.floor(n * 10) / 10;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} day${d === 1 ? "" : "s"}`;
}

/** A bar's width for a ratio, clamped to [0, 100]%. */
export function barWidth(ratio: number | null): string {
  return `${Math.min(100, Math.max(0, (ratio ?? 0) * 100))}%`;
}

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export function windowLabel(w: { from: string; to: string }): string {
  return `${DATE.format(new Date(w.from))} – ${DATE.format(new Date(w.to))}`;
}
