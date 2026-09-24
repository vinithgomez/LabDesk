import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { loginPath } from "./redirect";
import { useSession } from "./use-session";

/** Renders children only when signed in; otherwise sends the user to /login and back. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  if (status === "checking") {
    return (
      <p role="status" aria-live="polite" className="flex flex-1 items-center justify-center text-xl text-slate-300">
        Loading…
      </p>
    );
  }
  if (status === "signedOut") return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  return children;
}
