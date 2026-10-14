import {
  Ban,
  CircleCheck,
  CircleCheckBig,
  Clock3,
  LogIn,
  type LucideIcon,
  TimerOff,
  UserX,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn, ICON_STROKE } from "./util";

export type StatusKind =
  | "pending"
  | "approved"
  | "checked_in"
  | "completed"
  | "cancelled"
  | "rejected"
  | "no_show"
  | "expired";

const STATUS: Record<StatusKind, { label: string; icon: LucideIcon; tone: string }> = {
  pending: { label: "Pending", icon: Clock3, tone: "bg-st-pending-bg text-st-pending-fg border-st-pending-border" },
  approved: { label: "Approved", icon: CircleCheck, tone: "bg-st-approved-bg text-st-approved-fg border-st-approved-border" },
  checked_in: { label: "Checked in", icon: LogIn, tone: "bg-st-checked-in-bg text-st-checked-in-fg border-st-checked-in-border" },
  completed: { label: "Completed", icon: CircleCheckBig, tone: "bg-st-completed-bg text-st-completed-fg border-st-completed-border" },
  cancelled: { label: "Cancelled", icon: Ban, tone: "bg-st-cancelled-bg text-st-cancelled-fg border-st-cancelled-border" },
  rejected: { label: "Rejected", icon: XCircle, tone: "bg-st-cancelled-bg text-st-cancelled-fg border-st-cancelled-border" },
  no_show: { label: "No-show", icon: UserX, tone: "bg-st-cancelled-bg text-st-cancelled-fg border-st-cancelled-border" },
  expired: { label: "Expired", icon: TimerOff, tone: "bg-st-expired-bg text-st-expired-fg border-st-expired-border" },
};

/** A booking status: colour, icon and text, never colour alone (DESIGN.md §2). */
export function StatusPill({ status, className }: { status: StatusKind; className?: string }) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip border px-1.5 py-0.5 text-meta font-medium whitespace-nowrap",
        s.tone,
        className,
      )}
    >
      <s.icon aria-hidden="true" size={12} strokeWidth={ICON_STROKE} />
      {s.label}
    </span>
  );
}

export type BadgeTone = "neutral" | "cobalt" | "pending";

const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-sunken text-ink-muted border-line",
  cobalt: "bg-cobalt-tint text-st-approved-fg border-st-approved-border",
  pending: "bg-st-pending-bg text-st-pending-fg border-st-pending-border",
};

/** A small label for a property ("Needs approval", "Lab"). Not a status: use StatusPill for those. */
export function Badge({
  tone = "neutral",
  icon: Icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip border px-1.5 py-0.5 text-meta font-medium whitespace-nowrap",
        BADGE[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden="true" size={12} strokeWidth={ICON_STROKE} />}
      {children}
    </span>
  );
}

/** Two initials for a name ("Dr. Anita Rao" → "AR"). */
export function initials(name: string): string {
  const words = name
    .replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Initials in a small square tile (radius 6; only status dots are round). */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-cobalt-tint text-small font-semibold text-st-approved-fg",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** A figure with a plain label; the figure in Plex Sans Condensed with tabular numerals. */
export function Stat({ value, label, className }: { value: ReactNode; label: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="font-condensed text-h2 font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-small text-ink-muted">{label}</span>
    </div>
  );
}

/** A status dot: the only fully round shape. Always paired with text. */
export function Dot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", className)} />;
}

/** The logomark (a 3x3 grid of slots, one booked) and, optionally, the wordmark. */
export function Logo({ withWordmark = true, className }: { withWordmark?: boolean; className?: string }) {
  const cells = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ row, col })));
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true" className="shrink-0">
        {cells.map(({ row, col }) => (
          <rect
            key={`${row}-${col}`}
            x={col * 8}
            y={row * 8}
            width="6"
            height="6"
            rx="1"
            className={row === 1 && col === 1 ? "fill-cobalt" : "fill-line-strong"}
          />
        ))}
      </svg>
      {withWordmark ? (
        <span className="text-lead font-semibold tracking-[-0.01em] text-ink">LabDesk</span>
      ) : (
        <span className="sr-only">LabDesk</span>
      )}
    </span>
  );
}

/** Title, one plain line of description, and actions on the right (DESIGN.md §4). */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-4", className)}>
      <div className="min-w-0">
        {/* On phones the top bar already shows the title; the h1 stays for screen readers. */}
        <h1 className="text-h2 font-semibold text-ink max-md:sr-only md:text-h1">{title}</h1>
        {description && <p className="max-w-[72ch] text-body text-ink-muted md:mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** What's missing and what to do next. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 border-y border-line py-8">
      {Icon && <Icon aria-hidden="true" size={22} strokeWidth={ICON_STROKE} className="text-ink-faint" />}
      <p className="text-lead font-medium text-ink">{title}</p>
      {children && <p className="max-w-[72ch] text-body text-ink-muted">{children}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

/** A placeholder block shaped like what it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-chip bg-line", className)} />;
}

