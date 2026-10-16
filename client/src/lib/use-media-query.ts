import { useCallback, useSyncExternalStore } from "react";

/** The layout breakpoints (Tailwind's md and xl), as media queries. */
export const PHONE_QUERY = "(max-width: 767.98px)";
export const WIDE_QUERY = "(min-width: 1280px)";

/**
 * Whether a media query matches, kept in step as the window changes. Where
 * matchMedia doesn't exist (jsdom in tests), it answers `fallback`.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback;
  return useSyncExternalStore(subscribe, read, () => fallback);
}
