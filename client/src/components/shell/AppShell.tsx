import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck,
  ChevronsUpDown,
  ClipboardCheck,
  Ellipsis,
  LayoutGrid,
  LineChart,
  LogOut,
  type LucideIcon,
  ScanLine,
  Settings2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useTheme } from "../../lib/theme";
import { ROLE_LABEL, useMe } from "../../features/auth/use-me";
import { useSession } from "../../features/auth/use-session";
import { Avatar, Button, cn, ICON_STROKE, Logo, Sheet, Switch } from "../ui";
import { navItems, pageTitle, phoneTabs, type NavId, type NavItem } from "./nav";

const ICON: Record<NavId, LucideIcon> = {
  resources: LayoutGrid,
  bookings: CalendarCheck,
  scan: ScanLine,
  approvals: ClipboardCheck,
  analytics: LineChart,
  admin: Settings2,
};

/** The calendar uses the full width; everything else stops at 1200px. */
const FULL_WIDTH = (pathname: string) => /^\/resources\/[^/]+/.test(pathname);
/** Scanning and check-in were laid out for a phone. */
const PHONE_SCREEN = (pathname: string) => pathname === "/scan" || pathname === "/checkin";

/**
 * The app frame (DESIGN.md §4): a left rail on desktop (232px), an icon
 * rail on tablets (64px), a top bar and bottom tab bar on phones. Signed
 * out (sign-in, register), the page gets the whole screen.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const { pathname } = useLocation();
  if (status !== "signedIn") {
    return (
      <>
        <SkipLink />
        <main id="main" className="min-h-dvh">
          {children}
        </main>
      </>
    );
  }
  const content = PHONE_SCREEN(pathname) ? <div className="mx-auto flex w-full max-w-xl flex-col">{children}</div> : children;
  return (
    <div className="min-h-dvh md:flex">
      <SkipLink />
      <Rail />
      <div className="min-w-0 flex-1">
        <PhoneTopBar title={pageTitle(pathname)} />
        <main
          id="main"
          className={cn(
            "mx-auto w-full px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-10",
            FULL_WIDTH(pathname) ? "max-w-none" : "max-w-[1200px]",
          )}
        >
          {content}
        </main>
      </div>
      <PhoneTabBar />
    </div>
  );
}

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-control bg-surface px-3 py-2 text-body text-cobalt focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
    >
      Skip to content
    </a>
  );
}

// ---- Desktop and tablet rail ---------------------------------------------------

function Rail() {
  const me = useMe();
  const items = navItems(me.data?.role);
  const groups: { id: NavItem["group"]; label: string }[] = [
    { id: "book", label: "Book" },
    { id: "manage", label: "Manage" },
  ];
  return (
    <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col border-r border-line bg-surface md:flex lg:w-[232px]">
      <div className="flex h-16 items-center justify-center px-4 lg:justify-start">
        <span className="lg:hidden">
          <Logo withWordmark={false} />
        </span>
        <span className="hidden lg:block">
          <Logo />
        </span>
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 pt-2 lg:px-3">
        {groups.map((group) => {
          const groupItems = items.filter((i) => i.group === group.id);
          if (groupItems.length === 0) return null;
          return (
            <div key={group.id} className="flex flex-col gap-0.5">
              <p className="hidden px-3 pb-1 text-small font-medium text-ink-faint lg:block">{group.label}</p>
              <span aria-hidden="true" className="mx-3 mb-1 block border-t border-line lg:hidden" />
              <ul className="flex flex-col gap-0.5">
                {groupItems.map((item) => (
                  <RailLink key={item.id} item={item} />
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line p-2 lg:p-3">
        <UserMenu placement="rail" />
      </div>
    </aside>
  );
}

function RailLink({ item }: { item: NavItem }) {
  const Icon = ICON[item.id];
  return (
    <li className="group/rail relative">
      <NavLink
        to={item.to}
        className={({ isActive }) =>
          cn(
            "flex min-h-10 items-center justify-center gap-3 rounded-control px-3 text-body transition-colors duration-150 ease-out lg:justify-start",
            isActive ? "bg-cobalt-tint font-medium text-st-approved-fg" : "text-ink-muted hover:bg-sunken hover:text-ink",
          )
        }
      >
        <Icon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="shrink-0" />
        <span className="sr-only lg:not-sr-only">{item.label}</span>
      </NavLink>
      {/* Icon rail (tablet): the label as a tooltip on hover and focus. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-full z-50 ml-2 hidden -translate-y-1/2 rounded-chip bg-ink px-2 py-1 text-meta whitespace-nowrap text-surface shadow-float group-focus-within/rail:block group-hover/rail:block lg:!hidden"
      >
        {item.label}
      </span>
    </li>
  );
}

// ---- Phone ---------------------------------------------------------------------

function PhoneTopBar({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:hidden">
      <span className="flex min-w-0 items-center gap-2">
        <Logo withWordmark={false} />
        <span className="truncate text-lead font-semibold text-ink">{title}</span>
      </span>
      <UserMenu placement="topbar" />
    </header>
  );
}

function PhoneTabBar() {
  const me = useMe();
  const { tabs, more } = phoneTabs(navItems(me.data?.role));
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMoreOpen(false), [pathname]);
  const moreActive = more.some((i) => pathname.startsWith(i.to));
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="flex">
          {tabs.map((tab) =>
            tab === "more" ? (
              <li key="more" className="flex-1">
                <button
                  type="button"
                  onClick={() => setMoreOpen(true)}
                  aria-haspopup="dialog"
                  className={cn(
                    "flex h-16 w-full flex-col items-center justify-center gap-1 text-meta",
                    moreActive ? "text-cobalt" : "text-ink-muted",
                  )}
                >
                  <Ellipsis aria-hidden="true" size={20} strokeWidth={ICON_STROKE} />
                  More
                </button>
              </li>
            ) : (
              <li key={tab.id} className="flex-1">
                <TabLink item={tab} />
              </li>
            ),
          )}
        </ul>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="flex flex-col">
          {more.map((item) => {
            const Icon = ICON[item.id];
            return (
              <li key={item.id}>
                <NavLink
                  to={item.to}
                  className="flex min-h-12 items-center gap-3 rounded-control px-2 text-body text-ink hover:bg-sunken"
                >
                  <Icon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}

function TabLink({ item }: { item: NavItem }) {
  const Icon = ICON[item.id];
  const scan = item.id === "scan";
  return (
    <NavLink
      to={item.to}
      aria-label={item.label}
      className={({ isActive }) =>
        cn(
          "flex h-16 flex-col items-center justify-center gap-1 text-meta transition-colors duration-150 ease-out",
          isActive ? "text-cobalt" : "text-ink-muted",
        )
      }
    >
      {scan ? (
        // The prominent action: a filled cobalt tile.
        <span className="flex size-9 items-center justify-center rounded-control bg-primary text-on-cobalt">
          <Icon aria-hidden="true" size={20} strokeWidth={ICON_STROKE} />
        </span>
      ) : (
        <Icon aria-hidden="true" size={20} strokeWidth={ICON_STROKE} />
      )}
      <span aria-hidden="true">{item.short}</span>
    </NavLink>
  );
}

// ---- User menu ----------------------------------------------------------------

/** Name and role, with the theme switch and Sign out. A popover on the rail, a sheet on phones. */
function UserMenu({ placement }: { placement: "rail" | "topbar" }) {
  const me = useMe();
  const { signOut } = useSession();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popover = useRef<HTMLDivElement>(null);
  const name = me.data?.fullName ?? "Signed in";
  const role = me.data ? ROLE_LABEL[me.data.role] : "";

  useEffect(() => {
    if (!open || placement !== "rail") return;
    const onDown = (e: MouseEvent) => {
      if (popover.current && !popover.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, placement]);

  const onSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOut();
      // Nothing from the previous user may survive in the client cache.
      queryClient.clear();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign out. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const items = (
    <div className="flex flex-col gap-1">
      <Switch label="Dark theme" checked={theme === "dark"} onChange={(dark) => setTheme(dark ? "dark" : "light")} />
      <Button variant="quiet" icon={LogOut} onClick={() => void onSignOut()} loading={busy} className="justify-start px-2">
        Sign out
      </Button>
      {error && (
        <p role="alert" className="text-small text-danger-text">
          {error}
        </p>
      )}
    </div>
  );

  if (placement === "topbar") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`Account: ${name}`}
          className="inline-flex size-11 items-center justify-center rounded-control"
        >
          <Avatar name={name} />
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} title={name} description={role}>
          {items}
        </Sheet>
      </>
    );
  }

  return (
    <div ref={popover} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="user-menu"
        aria-label={`Account: ${name}`}
        className="flex w-full items-center justify-center gap-3 rounded-control p-1.5 text-left hover:bg-sunken lg:justify-start"
      >
        <Avatar name={name} />
        <span className="hidden min-w-0 flex-1 lg:block">
          <span className="block truncate text-body font-medium text-ink">{name}</span>
          <span className="block truncate text-small text-ink-muted">{role}</span>
        </span>
        <ChevronsUpDown aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className="hidden text-ink-faint lg:block" />
      </button>
      {open && (
        <div
          id="user-menu"
          className="absolute bottom-full left-0 z-50 mb-2 w-60 rounded-panel border border-line bg-surface p-3 shadow-float"
        >
          {items}
        </div>
      )}
    </div>
  );
}
