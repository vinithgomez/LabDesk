import { RotateCw } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Field, Input, Select } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { useDepartments } from "../resources/use-resources";
import { AuthLayout, FormError, PasswordInput } from "./AuthLayout";
import { departmentError } from "./register-form";
import { safeNext } from "./redirect";
import { useSession } from "./use-session";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [departmentProblem, setDepartmentProblem] = useState<string | null>(null);
  const departmentRef = useRef<HTMLSelectElement>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (status === "signedIn") return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const deptProblem = departmentError(form.departmentId);
    setDepartmentProblem(deptProblem);
    if (deptProblem) {
      departmentRef.current?.focus();
      return;
    }
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
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 font-semibold text-ink">Create your LabDesk account</h1>
          <p className="text-body text-ink-muted">New accounts are student accounts; an admin promotes staff.</p>
        </div>
        <Field label="Full name">
          {(control) => <Input {...control} autoComplete="name" required maxLength={120} value={form.fullName} onChange={set("fullName")} />}
        </Field>
        <Field label="College email">
          {(control) => <Input {...control} type="email" autoComplete="email" required value={form.email} onChange={set("email")} />}
        </Field>
        <Field label="Password" id="register-password" helper="8 to 72 characters.">
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={form.password}
              onChange={set("password")}
            />
          )}
        </Field>
        <div className="flex flex-col gap-2">
          <Field label="Department" error={departmentProblem} errorId="department-problem">
            {(control) => (
              <Select
                {...control}
                ref={departmentRef}
                value={form.departmentId}
                onChange={(e) => {
                  set("departmentId")(e);
                  setDepartmentProblem(null);
                }}
                disabled={!departments.data}
              >
                <option value="" disabled>
                  {departments.isPending ? "Loading departments…" : "Choose your department"}
                </option>
                {departments.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {departments.isError && (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body text-danger-text">
              <span>The department list didn&apos;t load. {describeApiError(departments.error)}</span>
              <Button icon={RotateCw} onClick={() => void departments.refetch()} loading={departments.isFetching}>
                Retry
              </Button>
            </div>
          )}
        </div>
        <Field
          label={
            <>
              Roll number <span className="font-normal text-ink-muted">(optional)</span>
            </>
          }
        >
          {(control) => <Input {...control} maxLength={32} value={form.rollNo} onChange={set("rollNo")} />}
        </Field>
        <FormError>{error}</FormError>
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Create account
        </Button>
        <p className="text-body text-ink-muted">
          Already have an account?{" "}
          <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-cobalt underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
