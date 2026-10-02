import type { ReactNode } from "react";

/** Dense controls shared by the admin tabs. */
export const control =
  "min-h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60 aria-[invalid=true]:border-rose-400";
export const button =
  "min-h-8 rounded-md px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50";
export const primary = `${button} bg-indigo-600 text-white`;
export const secondary = `${button} border border-slate-600 text-slate-200`;
export const danger = `${button} bg-rose-600 text-white`;
export const link = "text-sm text-indigo-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50";

/** A labelled field with its error, wired for screen readers. */
export function Field({
  id,
  label,
  hint,
  error,
  className = "",
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-xs text-slate-400">
        {label}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {hint && (
        <span id={`${id}-hint`} className="text-[11px] text-slate-500">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="text-xs text-rose-300">
          {error}
        </span>
      )}
    </div>
  );
}

/** A one-line result or problem, announced politely. */
export function Notice({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md p-2 text-sm ${tone === "error" ? "bg-rose-600/20 text-rose-200" : "bg-emerald-600/15 text-emerald-200"}`}
    >
      {children}
    </p>
  );
}

export const WEEKDAYS: { value: number; short: string; long: string }[] = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
];
