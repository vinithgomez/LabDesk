import { NavLink, Outlet } from "react-router-dom";
import { isAdmin, useMe } from "../auth/use-me";

const TABS = [
  { to: "/admin/resources", label: "Resources" },
];

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `-mb-px flex min-h-9 items-center border-b-2 px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
    isActive ? "border-indigo-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"
  }`;

/** §11 admin: resources, maintenance windows, incidents and users. Admins only (the server enforces it). */
export default function AdminPage() {
  const me = useMe();
  if (me.data && !isAdmin(me.data)) {
    return <p className="text-sm text-slate-300">The admin area is for admins.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold text-white">Admin</h1>
      <nav aria-label="Admin sections" className="flex flex-wrap gap-1 border-b border-slate-800">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={tabClass}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
