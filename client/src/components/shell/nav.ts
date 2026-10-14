/**
 * Navigation by role (DESIGN.md §4). Gating is a convenience only; the
 * server decides what anyone may do. The rules are the ones the old header
 * used: Approvals for staff, Analytics for the analytics roles, Admin for
 * admins; Resources, My bookings and Scan for everyone signed in.
 */
import { ANALYTICS_ROLES, isAdmin, isStaff, type Role } from "../../features/auth/use-me";

export type NavId = "resources" | "bookings" | "scan" | "approvals" | "analytics" | "admin";

export interface NavItem {
  id: NavId;
  label: string;
  /** Shorter label for the phone tab bar. */
  short: string;
  to: string;
  group: "book" | "manage";
}

const ALL: readonly NavItem[] = [
  { id: "resources", label: "Resources", short: "Resources", to: "/resources", group: "book" },
  { id: "bookings", label: "My bookings", short: "Bookings", to: "/bookings", group: "book" },
  { id: "scan", label: "Scan", short: "Scan", to: "/scan", group: "book" },
  { id: "approvals", label: "Approvals", short: "Approvals", to: "/approvals", group: "manage" },
  { id: "analytics", label: "Analytics", short: "Analytics", to: "/analytics", group: "manage" },
  { id: "admin", label: "Admin", short: "Admin", to: "/admin", group: "manage" },
];

/** The items a signed-in user with `role` sees (undefined while the role loads: Book items only). */
export function navItems(role: Role | undefined): NavItem[] {
  const me = role ? { role } : undefined;
  return ALL.filter((item) => {
    if (item.id === "approvals") return isStaff(me);
    if (item.id === "analytics") return role !== undefined && ANALYTICS_ROLES.includes(role);
    if (item.id === "admin") return isAdmin(me);
    return true;
  });
}

/** The tab bar holds at most this many items, the "More" button included. */
export const MAX_TABS = 5;

/**
 * Phone tabs: Scan in the centre as the prominent action, the others around
 * it in nav order; if they don't fit in five, the overflow goes in "More".
 */
export function phoneTabs(items: readonly NavItem[]): { tabs: (NavItem | "more")[]; more: NavItem[] } {
  const scan = items.find((i) => i.id === "scan");
  const others = items.filter((i) => i.id !== "scan");
  const slots = MAX_TABS - (scan ? 1 : 0);
  const fits = others.length <= slots;
  const shown = fits ? others : others.slice(0, slots - 1);
  const more = fits ? [] : others.slice(slots - 1);
  const tail: (NavItem | "more")[] = fits ? [] : ["more"];
  const row: (NavItem | "more")[] = [...shown, ...tail];
  if (!scan) return { tabs: row, more };
  const middle = Math.floor(row.length / 2);
  return { tabs: [...row.slice(0, middle), scan, ...row.slice(middle)], more };
}

/** The page title for the phone top bar, from the path. */
export function pageTitle(pathname: string): string {
  if (pathname.startsWith("/resources")) return "Resources";
  if (pathname.startsWith("/bookings") || pathname.startsWith("/series")) return "My bookings";
  if (pathname.startsWith("/scan")) return "Scan";
  if (pathname.startsWith("/checkin")) return "Check in";
  if (pathname.startsWith("/approvals")) return "Approvals";
  if (pathname.startsWith("/analytics")) return "Analytics";
  if (pathname.startsWith("/admin")) return "Admin";
  return "LabDesk";
}
