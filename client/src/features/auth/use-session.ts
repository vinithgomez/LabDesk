import { useEffect, useSyncExternalStore } from "react";
import {
  refreshSession,
  register as apiRegister,
  signIn as apiSignIn,
  signOut as apiSignOut,
  type RegisterInput,
} from "../../lib/api";

export type SessionStatus = "checking" | "signedIn" | "signedOut";

/*
 * One session for the whole app: the header, the pages and /login all read
 * the same status, so signing out anywhere updates everything at once.
 *
 * The boot-time refresh runs once per page load. Module-level so remounts
 * (routes, StrictMode) never refresh twice — a second refresh would replay a
 * rotated token and revoke the session.
 */
let status: SessionStatus = "checking";
let bootstrap: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: SessionStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

function ensureBootstrapped(): void {
  bootstrap ??= refreshSession().then((ok) => {
    // A sign-in that completed first wins over the boot check.
    if (status === "checking") setStatus(ok ? "signedIn" : "signedOut");
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function signIn(email: string, password: string): Promise<void> {
  await apiSignIn(email, password);
  setStatus("signedIn");
}

async function register(input: RegisterInput): Promise<void> {
  await apiRegister(input);
  setStatus("signedIn");
}

/** Revokes the session server-side, then drops local auth state. Throws if the server can't be reached. */
async function signOut(): Promise<void> {
  await apiSignOut();
  setStatus("signedOut");
}

/** The shared session: restores it from the refresh cookie on first use. */
export function useSession() {
  useEffect(ensureBootstrapped, []);
  const current = useSyncExternalStore(subscribe, () => status);
  return { status: current, signIn, signOut, register };
}
