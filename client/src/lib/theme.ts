import { useCallback, useSyncExternalStore } from "react";
import { THEMES, type ThemeName } from "../styles/tokens";

/**
 * Light or dark (DESIGN.md §4). A stored choice wins; without one the
 * system preference decides, and light is the default. index.html runs the
 * same rule inline before first paint, so there is no flash; this module
 * keeps it in step afterwards.
 */
export const THEME_STORAGE_KEY = "labdesk-theme";

/** The page background per theme, for <meta name="theme-color">. */
export const THEME_COLOR: Record<ThemeName, string> = {
  light: THEMES.light.bench,
  dark: THEMES.dark.bench,
};

/** The stored choice, or null. Storage can be unavailable (private mode, blocked): never throws. */
export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): ThemeName | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the choice; silently does nothing if storage is unavailable. */
export function storeTheme(theme: ThemeName, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not remembered this time; the theme still applies.
  }
}

/** The theme to show: the stored choice, else the system preference, else light. */
export function resolveTheme(stored: ThemeName | null, systemPrefersDark: boolean): ThemeName {
  return stored ?? (systemPrefersDark ? "dark" : "light");
}

/** Puts the theme on <html data-theme> and the browser's theme-color. */
export function applyTheme(theme: ThemeName, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The current theme and a setter that applies and remembers it. */
export function useTheme(): { theme: ThemeName; setTheme: (theme: ThemeName) => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as ThemeName);
  const setTheme = useCallback((next: ThemeName) => {
    applyTheme(next);
    storeTheme(next);
    for (const listener of listeners) listener();
  }, []);
  return { theme, setTheme };
}
