import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cn, ICON_STROKE, Input, Logo } from "../../components/ui";

/**
 * Sign-in and register (DESIGN.md §6): on desktop two equal halves, a
 * sunken one with a plain sentence and a small static strip of the timeline
 * motif, and a surface one with the form. Each half centres its own content
 * at a capped width (520px left, 380px right; DESIGN.md §4 "Wide screens"),
 * so nothing drifts to the far edges on a wide monitor. Below 1024px, only
 * the form.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section className="hidden justify-center border-r border-line bg-sunken px-12 py-10 lg:flex">
        {/* Logo, content and footer share one centred column, so their left edges line up. */}
        <div className="flex w-full max-w-[520px] flex-col">
          <Logo />
          <div className="flex flex-1 flex-col justify-center gap-8 py-12">
            <p className="text-h2 font-medium text-ink">
              LabDesk books your department&apos;s labs, rooms and equipment in a few seconds, checks people in at the door, and
              shows how every resource is really used.
            </p>
            <TimelineStrip />
          </div>
          <p className="text-small text-ink-muted">For students, faculty, lab in-charges and admins.</p>
        </div>
      </section>
      <section className="flex flex-col px-4 py-8 sm:px-8 md:justify-center lg:items-center lg:bg-surface lg:px-12">
        <div className="mx-auto flex w-full max-w-[380px] flex-col gap-8">
          <Logo className="lg:hidden" />
          {children}
        </div>
      </section>
    </div>
  );
}

/** A static strip of the week-calendar motif: ruler ticks, a hatched busy block, a booking and a pending request. */
function TimelineStrip() {
  const hours = ["09:00", "10:00", "11:00", "12:00", "13:00"];
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="relative h-14 overflow-hidden rounded-panel border border-line bg-surface">
        {/* Hour lines and half-hour lines, like graph paper. */}
        {hours.slice(0, -1).map((h, i) => (
          <span key={h} className="absolute inset-y-0 border-l border-line-strong" style={{ left: `${i * 25}%` }} />
        ))}
        {hours.slice(0, -1).map((h, i) => (
          <span key={`${h}-half`} className="absolute inset-y-0 border-l border-line" style={{ left: `${i * 25 + 12.5}%` }} />
        ))}
        <span className="hatch absolute inset-y-2 rounded-chip border-l-2 border-line-strong" style={{ left: "1%", width: "21%" }} />
        <span
          className="absolute inset-y-2 flex items-center rounded-chip bg-primary px-2 text-meta font-medium text-on-cobalt"
          style={{ left: "27%", width: "36%" }}
        >
          Lab record work
        </span>
        <span
          className="absolute inset-y-2 flex items-center rounded-chip border border-dashed border-st-pending-border bg-st-pending-bg px-2 text-meta font-medium text-st-pending-fg"
          style={{ left: "66%", width: "22%" }}
        >
          Pending
        </span>
      </div>
      {/* The time axis: a long tick at each hour, a short one at each half hour. */}
      <div className="relative h-6 font-condensed text-meta text-ink-muted tabular-nums">
        {hours.map((h, i) => (
          <span key={h} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${i * 25}%` }}>
            <span className="h-2 border-l border-line-strong" />
            {h}
          </span>
        ))}
        {hours.slice(0, -1).map((h, i) => (
          <span key={`${h}-t`} className="absolute top-0 h-1 border-l border-line-strong" style={{ left: `${i * 25 + 12.5}%` }} />
        ))}
      </div>
    </div>
  );
}

/** A password input with a show/hide toggle (aria-pressed), for the Field render prop. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { id: string }>(
  function PasswordInput({ id, className, ...rest }, ref) {
    const [shown, setShown] = useState(false);
    return (
      <div className="relative">
        <Input ref={ref} id={id} type={shown ? "text" : "password"} className={cn("pr-12", className)} {...rest} />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-controls={id}
          aria-label={shown ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-control text-ink-muted hover:text-ink"
        >
          {shown ? (
            <EyeOff aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          ) : (
            <Eye aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          )}
        </button>
      </div>
    );
  },
);

/** A form-level problem (the API's sentence), announced; empty keeps its space so the layout doesn't jump. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className={cn("text-body text-danger-text", !children && "-my-2.5")}>
      {children}
    </p>
  );
}
