import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { ANALYTICS_ROLES, useMe } from "./use-me";
import { useSession } from "./use-session";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-12 items-center rounded-xl px-3 text-base font-medium focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400 ${
    isActive ? "bg-slate-800 text-white" : "text-slate-300"
  }`;

/** App header: the wordmark, navigation and Sign out whenever someone is signed in. */
export function AppHeader() {
  const { status, signOut } = useSession();
  const me = useMe();
  const canSeeAnalytics = me.data ? ANALYTICS_ROLES.includes(me.data.role) : false;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <header className="mb-6 flex flex-col gap-2">
      <div className="flex min-h-12 items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="mr-2 text-lg font-bold tracking-tight text-white">LabDesk</span>
          {status === "signedIn" && canSeeAnalytics && (
            <nav aria-label="Main" className="flex gap-1">
              <NavLink to="/scan" className={navClass}>
                Scan
              </NavLink>
              <NavLink to="/analytics" className={navClass}>
                Analytics
              </NavLink>
            </nav>
          )}
        </div>
        {status === "signedIn" && (
          <button
            type="button"
            onClick={() => void onSignOut()}
            disabled={busy}
            className="min-h-12 rounded-xl border border-slate-600 px-4 text-base font-medium text-slate-200 disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-rose-600/20 p-3 text-rose-200">
          {error}
        </p>
      )}
    </header>
  );
}
