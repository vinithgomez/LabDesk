import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { safeNext } from "./redirect";
import { SignInForm } from "./SignInForm";
import { useSession } from "./use-session";

/** The login screen. Signed-in visitors go straight on to `next`. */
export default function LoginPage() {
  const { status, signIn } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));

  if (status === "signedIn") return <Navigate to={next} replace />;
  if (status === "checking") {
    return <p className="flex flex-1 items-center justify-center text-xl text-slate-300">Loading…</p>;
  }
  return (
    <SignInForm
      registerHref={`/register?next=${encodeURIComponent(next)}`}
      onSignIn={async (email, password) => {
        await signIn(email, password);
        navigate(next, { replace: true });
      }}
    />
  );
}
