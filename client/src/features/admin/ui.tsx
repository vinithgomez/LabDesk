import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn, ICON_STROKE } from "../../components/ui";

/** A one-line result or problem in an admin tab: announced (status politely, errors as alerts), with an icon as well as colour. */
export function Notice({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-control border px-3 py-2 text-body",
        tone === "error"
          ? "border-st-cancelled-border bg-st-cancelled-bg text-st-cancelled-fg"
          : "border-st-checked-in-border bg-st-checked-in-bg text-st-checked-in-fg",
      )}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A form or tool block inside an admin tab: the one panel level (DESIGN.md §2). */
export function AdminPanel({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4 rounded-panel border border-line bg-surface p-4 md:p-5", className)}>
      <h2 className="text-lead font-semibold text-ink">{title}</h2>
      {children}
    </div>
  );
}
