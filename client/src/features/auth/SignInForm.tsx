import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../../lib/api-errors";

/** Shown when there's no session. `registerHref` links to account creation. */
export function SignInForm({
  onSignIn,
  registerHref,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
  registerHref: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSignIn(email, password);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const field =
    "min-h-14 rounded-xl border border-slate-700 bg-slate-900 px-4 text-lg text-white placeholder:text-slate-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400";

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col justify-center gap-4">
      <h1 className="text-2xl font-bold text-white">Sign in to LabDesk</h1>
      <label className="flex flex-col gap-2 text-slate-300">
        Email
        <input className={field} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="flex flex-col gap-2 text-slate-300">
        Password
        <div className="relative">
          <input
            id="sign-in-password"
            className={`${field} w-full pr-12`}
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-pressed={showPassword}
            aria-controls="sign-in-password"
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 hover:text-slate-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400"
          >
            <EyeIcon crossedOut={showPassword} />
          </button>
        </div>
      </label>
      <p role="alert" className="min-h-6 text-rose-400">
        {error}
      </p>
      <button
        type="submit"
        disabled={busy}
        className="min-h-16 rounded-2xl bg-indigo-600 text-lg font-semibold text-white disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-slate-400">
        New here?{" "}
        <Link to={registerHref} className="font-medium text-indigo-300 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400">
          Create an account
        </Link>
      </p>
    </form>
  );
}

/** An open eye, or the same eye with a slash through it when the password is visible. */
export function EyeIcon({ crossedOut }: { crossedOut: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
      {crossedOut && <path strokeLinecap="round" d="M3 3l18 18" />}
    </svg>
  );
}
