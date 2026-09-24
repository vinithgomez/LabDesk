import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useSession } from "./use-session";

/** App header: the wordmark, plus Sign out whenever someone is signed in. */
export function AppHeader() {
  const { status, signOut } = useSession();
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
        <span className="text-lg font-bold tracking-tight text-white">LabDesk</span>
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
