import { STATUS_LABEL, statusTone, type StatusTone } from "./status";
import type { BookingStatus } from "./types";

const TONE_CLASS: Record<StatusTone, string> = {
  pending: "bg-amber-400/15 text-amber-300 ring-amber-400/40",
  approved: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/40",
  rejected: "bg-rose-400/15 text-rose-300 ring-rose-400/40",
  neutral: "bg-slate-400/10 text-slate-300 ring-slate-400/30",
};

export function StatusBadge({ status }: { status: BookingStatus | "expired" }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-px text-[11px] font-semibold leading-4 ring-1 ring-inset ${TONE_CLASS[statusTone(status)]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
