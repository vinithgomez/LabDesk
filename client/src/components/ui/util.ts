/** Joins class names, skipping falsy ones. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** One stroke width for every lucide icon (DESIGN.md §5). */
export const ICON_STROKE = 1.75;

/**
 * Shared control styling: 44px tall on phones (touch target), 36px from
 * tablet up; 16px text on phones so iOS doesn't zoom; radius 6 by role.
 */
export const controlClass =
  "w-full min-h-11 md:min-h-9 rounded-control border border-line-strong bg-surface px-3 text-[16px] md:text-body text-ink placeholder:text-ink-faint " +
  "transition-colors duration-150 ease-out hover:border-ink-muted disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-faint " +
  "aria-[invalid=true]:border-danger-text";
