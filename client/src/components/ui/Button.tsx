import { LoaderCircle, type LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn, ICON_STROKE } from "./util";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-cobalt hover:bg-primary-strong",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
  quiet: "text-cobalt hover:bg-cobalt-tint",
  danger: "bg-danger text-on-cobalt hover:brightness-95",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Busy: shows a spinner and keeps the button's width (the label stays, invisibly). */
  loading?: boolean;
  icon?: LucideIcon;
  children: ReactNode;
}

/**
 * One primary action per view (DESIGN.md §2). Verbs for labels. 44px tall
 * on phones, 36px from tablet up; radius 6.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", loading = false, icon: Icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-body font-medium md:min-h-9",
        "transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
        {Icon && <Icon aria-hidden="true" size={16} strokeWidth={ICON_STROKE} />}
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <LoaderCircle size={16} strokeWidth={ICON_STROKE} className="animate-spin" />
        </span>
      )}
    </button>
  );
});
