import { afterEach, describe, expect, it } from "vitest";
import html from "../../index.html?raw";
import { applyTheme, readStoredTheme, resolveTheme, THEME_COLOR, THEME_STORAGE_KEY } from "./theme";

/**
 * The theme rule (DESIGN.md §4): a stored choice wins; without one the app
 * is light, even when the system prefers dark. index.html's pre-paint
 * script must follow the same rule as theme.ts.
 */

const storage = (value: string | null) => ({ getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null) });

describe("resolveTheme", () => {
  it("is light with nothing stored", () => {
    expect(resolveTheme(null)).toBe("light");
  });

  it("uses the stored choice", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });
});

describe("readStoredTheme", () => {
  it("reads only light or dark", () => {
    expect(readStoredTheme(storage("dark"))).toBe("dark");
    expect(readStoredTheme(storage("light"))).toBe("light");
    expect(readStoredTheme(storage("sepia"))).toBeNull();
    expect(readStoredTheme(storage(null))).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readStoredTheme(blocked)).toBeNull();
    expect(readStoredTheme(undefined)).toBeNull();
  });
});

describe("index.html pre-paint script", () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

  /** Runs the inline script against a fake window whose system preference is `prefersDark`. */
  function run(stored: string | null | "throws", prefersDark: boolean) {
    const fakeWindow = {
      localStorage: {
        getItem: () => {
          if (stored === "throws") throw new Error("SecurityError");
          return stored;
        },
      },
      matchMedia: (query: string) => ({ matches: prefersDark && query.includes("dark") }),
    };
    new Function("window", "document", script)(fakeWindow, document);
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      color: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    };
  }

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.head.innerHTML = "";
  });

  it("exists", () => {
    expect(script).toContain("labdesk-theme");
  });

  it.each([
    ["nothing stored, system light", null, false, "light"],
    ["nothing stored, system dark", null, true, "light"],
    ["storage blocked, system dark", "throws", true, "light"],
    ["stored dark, system light", "dark", false, "dark"],
    ["stored light, system dark", "light", true, "light"],
  ] as const)("%s → %s", (_label, stored, prefersDark, expected) => {
    document.head.innerHTML = '<meta name="theme-color" content="">';
    const result = run(stored, prefersDark);
    expect(result.theme).toBe(expected);
    expect(result.color).toBe(THEME_COLOR[expected]);
  });
});

describe("applyTheme", () => {
  it("sets data-theme and the theme-color", () => {
    document.head.innerHTML = '<meta name="theme-color" content="">';
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(THEME_COLOR.dark);
    document.documentElement.removeAttribute("data-theme");
    document.head.innerHTML = "";
  });
});
