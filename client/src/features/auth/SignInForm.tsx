import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Field, Input } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { AuthLayout, FormError, PasswordInput } from "./AuthLayout";

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

  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 font-semibold text-ink">Sign in to LabDesk</h1>
          <p className="text-body text-ink-muted">Use your college email.</p>
        </div>
        <Field label="Email">
          {(control) => (
            <Input {...control} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label="Password" id="sign-in-password">
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <FormError>{error}</FormError>
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Sign in
        </Button>
        <p className="text-body text-ink-muted">
          New here?{" "}
          <Link to={registerHref} className="font-medium text-cobalt underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
