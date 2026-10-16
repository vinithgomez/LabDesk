import { Settings2 } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { cn, EmptyState, PageHeader } from "../../components/ui";
import { isAdmin, useMe } from "../auth/use-me";

const TABS = [
  { to: "/admin/resources", label: "Resources" },
  { to: "/admin/maintenance", label: "Maintenance" },
  { to: "/admin/incidents", label: "Incidents" },
  { to: "/admin/users", label: "Users" },
];

/**
 * §11 admin: resources, maintenance windows, incidents and users. Admins only
 * (the server enforces it). The sections are routes, so they are links drawn
 * as tabs (aria-current marks the open one), not a tablist.
 */
export default function AdminPage() {
  const me = useMe();
  // Wait for the role, so non-admins never fire admin-only requests.
  if (!me.data) return <p className="text-body text-ink-muted">Loading…</p>;
  if (!isAdmin(me.data)) {
    return (
      <EmptyState icon={Settings2} title="The admin area is for admins.">
        Ask an admin if you need a resource, a maintenance window or a role changed.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        <PageHeader title="Admin" description="Resources and their owners, maintenance windows, incidents, and who can do what." />
        <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--line)]">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cn(
                  // Tighter on phones, so all four sections fit across without scrolling.
                  "inline-flex min-h-11 shrink-0 items-center border-b-2 px-2 text-small font-medium whitespace-nowrap transition-colors duration-150 ease-out md:min-h-9 md:px-3 md:text-body",
                  isActive ? "border-cobalt text-ink" : "border-transparent text-ink-muted hover:text-ink",
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
