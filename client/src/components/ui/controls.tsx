import { ChevronDown } from "lucide-react";
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn, controlClass, ICON_STROKE } from "./util";

/** A text input. Pair it with Field for its label, helper and error. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(controlClass, className)} {...rest} />;
});

/** A native select with the shared styling and a chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <span className="relative block">
        <select ref={ref} className={cn(controlClass, "appearance-none pr-9", className)} {...rest}>
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          size={16}
          strokeWidth={ICON_STROKE}
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-muted"
        />
      </span>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(controlClass, "py-2", className)} {...rest} />;
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
}

/** A checkbox with its label; the whole row is the target. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, className, ...rest }, ref) {
  return (
    <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 text-body text-ink md:min-h-9", className)}>
      <input ref={ref} type="checkbox" className="size-4 shrink-0 accent-cobalt" {...rest} />
      <span>{label}</span>
    </label>
  );
});

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
  disabled?: boolean;
}

/** An on/off switch (role="switch"); the label names it. */
export function Switch({ checked, onChange, label, hideLabel = false, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 items-center gap-3 text-body text-ink disabled:opacity-60 md:min-h-9"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 ease-out",
          checked ? "border-primary bg-primary" : "border-line-strong bg-sunken",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0 size-3.5 rounded-full transition-transform duration-150 ease-out",
            checked ? "translate-x-[18px] bg-on-cobalt" : "translate-x-0.5 bg-ink-muted",
          )}
        />
      </span>
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
    </button>
  );
}
