import { CircleAlert, CircleCheckBig, Clock3, type LucideIcon } from "lucide-react";
import { Button, cn, ICON_STROKE } from "../../components/ui";
import type { Outcome } from "./messages";

const LOOK: Record<Outcome["tone"], { icon: LucideIcon; panel: string }> = {
  success: { icon: CircleCheckBig, panel: "border-st-checked-in-border bg-st-checked-in-bg text-st-checked-in-fg" },
  wait: { icon: Clock3, panel: "border-st-pending-border bg-st-pending-bg text-st-pending-fg" },
  failure: { icon: CircleAlert, panel: "border-st-cancelled-border bg-st-cancelled-bg text-st-cancelled-fg" },
};

/**
 * The large, unmissable result of a scan: a status-coloured panel with the
 * icon, the title, the reason and the next step (never colour alone).
 * Announced to screen readers.
 */
export function ResultPanel({ outcome, onAgain, againLabel }: { outcome: Outcome; onAgain: () => void; againLabel: string }) {
  const look = LOOK[outcome.tone];
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div
        role="status"
        aria-live="assertive"
        className={cn("flex min-h-[22rem] flex-1 flex-col items-center justify-center gap-3 rounded-panel border-2 p-8 text-center", look.panel)}
      >
        <look.icon aria-hidden="true" size={72} strokeWidth={ICON_STROKE} />
        <p className="text-h1 font-semibold">{outcome.title}</p>
        <p className="max-w-[40ch] text-lead">{outcome.detail}</p>
        <p className="mt-2 max-w-[40ch] border-t border-current/25 pt-3 text-body font-medium">{outcome.next}</p>
      </div>
      <Button variant="primary" onClick={onAgain} className="min-h-14 text-lead">
        {againLabel}
      </Button>
    </div>
  );
}

