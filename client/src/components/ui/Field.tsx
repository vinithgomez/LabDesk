import { CircleAlert } from "lucide-react";
import { useId, type ReactNode } from "react";
import { cn, ICON_STROKE } from "./util";

/** What a Field hands its control: the id its label points at, and the description wiring. */
export interface FieldControlProps {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
}

export interface FieldProps {
  label: ReactNode;
  /** Shown under the label's control; linked as its description. */
  helper?: ReactNode;
  /** Shown inline, with an icon; linked as its description and marks the control invalid. */
  error?: ReactNode;
  /** The control id; generated when omitted. */
  id?: string;
  /** The id the error element gets (so callers or tests can reach it). */
  errorId?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label above, helper text, inline error linked with aria-describedby
 * (DESIGN.md §5). The control is rendered by the children function, so the
 * wiring always reaches the real element.
 */
export function Field({ label, helper, error, id, errorId, className, children }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `field-${auto}`;
  const helperId = `${controlId}-helper`;
  const errId = errorId ?? `${controlId}-error`;
  const describedBy = [helper ? helperId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={controlId} className="text-small font-medium text-ink">
        {label}
      </label>
      {children({ id: controlId, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {helper && (
        <p id={helperId} className="text-small text-ink-muted">
          {helper}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="flex items-start gap-1.5 text-small text-danger-text">
          <CircleAlert aria-hidden="true" size={14} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
