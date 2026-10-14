import { describe, expect, it } from "vitest";
import css from "../index.css?raw";
import { CSS_VAR, STATUS_VAR, THEMES, type StatusName, type Theme, type ThemeName } from "./tokens";

/**
 * WCAG 2.x contrast for every text-on-background pair the design uses
 * (DESIGN.md §3), in both themes: text at least 4.5:1, UI borders and focus
 * indicators at least 3:1. Also checks that index.css declares exactly the
 * values in tokens.ts, so what is tested is what ships.
 */

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const UI = 3;
const STATUSES: StatusName[] = ["pending", "approved", "checkedIn", "completed", "cancelled", "expired"];

/** [description, foreground, background] text pairs for a theme. */
function textPairs(t: Theme): [string, string, string][] {
  const pairs: [string, string, string][] = [];
  for (const bg of ["bench", "surface", "sunken"] as const) {
    pairs.push([`ink on ${bg}`, t.ink, t[bg]]);
    pairs.push([`ink-muted on ${bg}`, t.inkMuted, t[bg]]);
    pairs.push([`ink-faint on ${bg}`, t.inkFaint, t[bg]]);
    pairs.push([`cobalt (links) on ${bg}`, t.cobalt, t[bg]]);
    pairs.push([`danger text on ${bg}`, t.dangerText, t[bg]]);
    pairs.push([`checked-in text (free today) on ${bg}`, t.status.checkedIn.fg, t[bg]]);
  }
  pairs.push(["ink on cobalt-tint (selected row, today column)", t.ink, t.cobaltTint]);
  pairs.push(["cobalt on cobalt-tint", t.cobalt, t.cobaltTint]);
  pairs.push(["approved text on cobalt-tint (active nav, avatar)", t.status.approved.fg, t.cobaltTint]);
  pairs.push(["on-cobalt on primary button", t.onCobalt, t.primary]);
  pairs.push(["on-cobalt on primary hover", t.onCobalt, t.primaryStrong]);
  pairs.push(["on-cobalt on danger button", t.onCobalt, t.danger]);
  pairs.push(["surface text on ink (tooltip)", t.surface, t.ink]);
  for (const s of STATUSES) pairs.push([`${s} pill text`, t.status[s].fg, t.status[s].bg]);
  return pairs;
}

/** [description, colour, background] pairs that must stand out as UI (3:1). */
function uiPairs(t: Theme): [string, string, string][] {
  return [
    ["input border (line-strong) on surface", t.lineStrong, t.surface],
    ["input border (line-strong) on bench", t.lineStrong, t.bench],
    ["focus ring (cobalt) on bench", t.cobalt, t.bench],
    ["focus ring (cobalt) on surface", t.cobalt, t.surface],
    ["primary button edge on bench", t.primary, t.bench],
    ["primary button edge on surface", t.primary, t.surface],
  ];
}

describe.each(["light", "dark"] as ThemeName[])("%s theme contrast", (name) => {
  const t = THEMES[name];

  it.each(textPairs(t))("text: %s", (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(uiPairs(t))("UI: %s", (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(UI);
  });
});

describe("dark status colours", () => {
  it.each(STATUSES)("%s keeps at least the light theme's contrast", (s) => {
    const light = THEMES.light.status[s];
    const dark = THEMES.dark.status[s];
    expect(contrast(dark.fg, dark.bg)).toBeGreaterThanOrEqual(contrast(light.fg, light.bg));
  });
});

describe("contrast()", () => {
  it("matches known WCAG values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
});

/** The custom properties declared in the CSS block starting at `selector`. */
function declared(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in index.css`);
  const body = css.slice(start, css.indexOf("}", start));
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) vars.set(m[1] ?? "", (m[2] ?? "").toUpperCase());
  return vars;
}

describe("index.css matches tokens.ts", () => {
  it.each([
    ["light", ":root"],
    ["dark", ':root[data-theme="dark"]'],
  ] as const)("%s", (name, selector) => {
    const vars = declared(selector);
    const t = THEMES[name];
    for (const [key, cssVar] of Object.entries(CSS_VAR)) {
      expect(vars.get(cssVar), `${name} ${cssVar}`).toBe(t[key as keyof typeof CSS_VAR].toUpperCase());
    }
    for (const s of STATUSES) {
      for (const part of ["bg", "fg", "border"] as const) {
        expect(vars.get(`--st-${STATUS_VAR[s]}-${part}`), `${name} ${s} ${part}`).toBe(t.status[s][part].toUpperCase());
      }
    }
  });
});
