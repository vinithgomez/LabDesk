import type { LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn, ICON_STROKE } from "./util";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  /** The accessible name, and the hover hint. Required: an icon alone is not a label. */
  label: string;
}

/** A square icon-only button: 44px on phones, 36px from tablet up. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted md:size-9",
        "transition-colors duration-150 ease-out hover:bg-sunken hover:text-ink disabled:opacity-60",
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
    </button>
  );
});
