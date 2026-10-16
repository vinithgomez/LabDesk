/**
 * Design tokens (DESIGN.md §3), the single source of truth for colour.
 * index.css declares the same values as CSS variables; tokens.contrast.test.ts
 * checks both that they match and that every text/background pair meets WCAG.
 *
 * Three values differ from DESIGN.md because the spec's values failed its own
 * contrast rules (see the test): light --ink-faint (was #6F7A73), light and
 * dark --line-strong (were #B9BEB3 and #3A453F). Same hue, just far enough to pass.
 *
 * Because --line-strong is now an input border, the calendar does not draw its
 * grid with it (DESIGN.md §7 said so): --grid-hour and --grid-half are softer
 * graph-paper lines, decorative only.
 */

export type ThemeName = "light" | "dark";

export interface StatusColours {
  bg: string;
  fg: string;
  border: string;
}

export type StatusName = "pending" | "approved" | "checkedIn" | "completed" | "cancelled" | "expired";

export interface Theme {
  bench: string;
  surface: string;
  sunken: string;
  line: string;
  lineStrong: string;
  /** Calendar hour lines: decorative, deliberately softer than lineStrong (an input border). */
  gridHour: string;
  /** Calendar half-hour lines: softer still. */
  gridHalf: string;
  /** Someone else's booking on the calendar: its fill, its 1px edge and the lines of its hatch. */
  busy: string;
  busyEdge: string;
  busyHatch: string;
  /**
   * The heatmap's single-hue ramp (DESIGN.md §3), lightest to strongest:
   * light from --cobalt-tint to --cobalt, dark from just above --surface to
   * #7C9BFF. A zero cell isn't on the ramp: it is an outlined empty cell.
   */
  heat: readonly [string, string, string, string, string];
  ink: string;
  inkMuted: string;
  inkFaint: string;
  /** Links, focus ring, "my booking" accent. */
  cobalt: string;
  cobaltStrong: string;
  cobaltTint: string;
  /** Primary button fill and its hover; in light these are --cobalt and --cobalt-strong. */
  primary: string;
  primaryStrong: string;
  onCobalt: string;
  /** Danger button fill, and danger text on surfaces. */
  danger: string;
  dangerText: string;
  status: Record<StatusName, StatusColours>;
}

export const THEMES: Record<ThemeName, Theme> = {
  light: {
    bench: "#F3F4F1",
    surface: "#FFFFFF",
    sunken: "#EAECE7",
    line: "#D9DCD4",
    lineStrong: "#848880",
    gridHour: "#CBCFC5",
    gridHalf: "#E1E4DC",
    busy: "#EAECE7",
    busyEdge: "#B4B9AF",
    busyHatch: "#848880",
    heat: ["#E3EAFB", "#B2C1ED", "#8198E0", "#5070D2", "#1F47C4"],
    ink: "#16201C",
    inkMuted: "#55605A",
    inkFaint: "#626C66",
    cobalt: "#1F47C4",
    cobaltStrong: "#1A3BA3",
    cobaltTint: "#E3EAFB",
    primary: "#1F47C4",
    primaryStrong: "#1A3BA3",
    onCobalt: "#FFFFFF",
    danger: "#B42318",
    dangerText: "#B42318",
    status: {
      pending: { bg: "#FBEFD2", fg: "#6B4200", border: "#E4B95A" },
      approved: { bg: "#E3EAFB", fg: "#17338F", border: "#A9BBF2" },
      checkedIn: { bg: "#DCF1E3", fg: "#14532D", border: "#8CCBA2" },
      completed: { bg: "#EAECE7", fg: "#55605A", border: "#D9DCD4" },
      cancelled: { bg: "#F7DDDA", fg: "#8A1C12", border: "#E8A59E" },
      expired: { bg: "#EAECE7", fg: "#626C66", border: "#D9DCD4" },
    },
  },
  dark: {
    bench: "#0F1512",
    surface: "#161D19",
    sunken: "#0B100D",
    line: "#27302B",
    lineStrong: "#606964",
    gridHour: "#353F39",
    gridHalf: "#252D28",
    // Lighter than the surface in dark, so a busy block reads as a thing, not a hole.
    busy: "#28312C",
    busyEdge: "#727C76",
    busyHatch: "#727C76",
    heat: ["#2A3647", "#3F4F75", "#5369A3", "#6882D1", "#7C9BFF"],
    ink: "#E8ECE7",
    inkMuted: "#A3ADA6",
    inkFaint: "#8A958E",
    cobalt: "#7C9BFF",
    cobaltStrong: "#9DB4FF",
    cobaltTint: "#1B2748",
    primary: "#3F66E8",
    primaryStrong: "#3457D6",
    onCobalt: "#FFFFFF",
    danger: "#B93A2E",
    dangerText: "#F7B2A9",
    status: {
      pending: { bg: "#2E2207", fg: "#F7CD7E", border: "#7A5A1C" },
      approved: { bg: "#1B2748", fg: "#C3D0FF", border: "#3D5299" },
      checkedIn: { bg: "#0F2A1B", fg: "#9FE3B6", border: "#2F6B47" },
      completed: { bg: "#0B100D", fg: "#A3ADA6", border: "#27302B" },
      cancelled: { bg: "#33130F", fg: "#F7B2A9", border: "#7A3229" },
      expired: { bg: "#0B100D", fg: "#8A958E", border: "#27302B" },
    },
  },
};

/** CSS variable name for each theme key (status keys are flattened as --st-<name>-<part>, heat as --heat-1 … --heat-5). */
export const CSS_VAR: Record<Exclude<keyof Theme, "status" | "heat">, string> = {
  bench: "--bench",
  surface: "--surface",
  sunken: "--sunken",
  line: "--line",
  lineStrong: "--line-strong",
  gridHour: "--grid-hour",
  gridHalf: "--grid-half",
  busy: "--busy",
  busyEdge: "--busy-edge",
  busyHatch: "--busy-hatch",
  ink: "--ink",
  inkMuted: "--ink-muted",
  inkFaint: "--ink-faint",
  cobalt: "--cobalt",
  cobaltStrong: "--cobalt-strong",
  cobaltTint: "--cobalt-tint",
  primary: "--primary",
  primaryStrong: "--primary-strong",
  onCobalt: "--on-cobalt",
  danger: "--danger",
  dangerText: "--danger-text",
};

export const STATUS_VAR: Record<StatusName, string> = {
  pending: "pending",
  approved: "approved",
  checkedIn: "checked-in",
  completed: "completed",
  cancelled: "cancelled",
  expired: "expired",
};
