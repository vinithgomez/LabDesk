import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { describeApiError } from "../../lib/api-errors";
import { useDepartments } from "../resources/use-resources";
import { safeNext } from "./redirect";
import { EyeIcon } from "./SignInForm";
import { useSession } from "./use-session";

const field =
  "min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-base text-white placeholder:text-slate-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400";

/**
 * Account creation. Every new account is a student (CLAUDE.md §2b); an
 * admin promotes staff later. Departments come from the public list.
 */
export default function RegisterPage() {
  const { status, register } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));
  const departments = useDepartments();

  const [form, setForm] = useState({ fullName: "", email: "", password: "", departmentId: "", rollNo: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (status === "signedIn") return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        departmentId: form.departmentId,
        ...(form.rollNo.trim() ? { rollNo: form.rollNo.trim() } : {}),
      });
      navigate(next, { replace: true });
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold text-white">Create your LabDesk account</h1>
      <p className="text-sm text-slate-400">New accounts are student accounts; staff are promoted by an admin.</p>
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Full name
        <input className={field} autoComplete="name" required maxLength={120} value={form.fullName} onChange={set("fullName")} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        College email
        <input className={field} type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Password <span className="text-xs text-slate-500">(8–72 characters)</span>
        <div className="relative">
          <input
            id="register-password"
            className={`${field} w-full pr-12`}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={form.password}
            onChange={set("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-pressed={showPassword}
            aria-controls="register-password"
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400"
          >
            <EyeIcon crossedOut={showPassword} />
          </button>
        </div>
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Department
        <select className={field} required value={form.departmentId} onChange={set("departmentId")} disabled={!departments.data}>
          <option value="" disabled>
            {departments.isPending ? "Loading departments…" : "Choose your department"}
          </option>
          {departments.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.code})
            </option>
          ))}
        </select>
      </label>
      {departments.isError && (
        <p role="alert" className="text-sm text-rose-300">
          {describeApiError(departments.error)}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Roll number <span className="text-xs text-slate-500">(optional)</span>
        <input className={field} maxLength={32} value={form.rollNo} onChange={set("rollNo")} />
      </label>
      <p role="alert" className="min-h-5 text-sm text-rose-300">
        {error}
      </p>
      <button
        type="submit"
        disabled={busy}
        className="min-h-12 rounded-xl bg-indigo-600 text-base font-semibold text-white disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300"
      >
        {busy ? "Creating account…" : "Create account"}
      </button>
      <p className="text-center text-sm text-slate-400">
        Already have an account?{" "}
        <Link
          to={`/login?next=${encodeURIComponent(next)}`}
          className="font-medium text-indigo-300 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
