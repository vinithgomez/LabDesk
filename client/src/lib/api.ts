/**
 * Minimal API client. The access token lives only in memory (CLAUDE.md §3);
 * the refresh token is an httpOnly cookie the browser sends to /api/auth.
 *
 * Refresh tokens are single-use: presenting one twice is treated as theft
 * and revokes the whole session. So concurrent refreshes (e.g. React
 * StrictMode running an effect twice) must share ONE request — see
 * `refreshSession`.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = undefined,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;
let inflightRefresh: Promise<boolean> | null = null;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function tokenFrom(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  return typeof body.data.accessToken === "string" ? body.data.accessToken : null;
}

/** Exchanges the refresh cookie for a new access token. Deduplicated. */
export function refreshSession(): Promise<boolean> {
  inflightRefresh ??= (async () => {
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
      accessToken = res.ok ? tokenFrom(await res.json()) : null;
      return accessToken !== null;
    } catch {
      return false;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

export async function signIn(email: string, password: string): Promise<void> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, body);
  accessToken = tokenFrom(body);
}

/**
 * Ends the session: the server revokes the refresh-token family and clears
 * the cookie, then the in-memory access token is dropped. Throws (leaving the
 * session intact) if the server can't be reached — the httpOnly cookie can
 * only be cleared by the server, so claiming a sign-out that didn't happen
 * would leave the next page load silently signed back in.
 */
export async function signOut(): Promise<void> {
  // A refresh finishing after logout would restore a token; let it land first.
  if (inflightRefresh) await inflightRefresh;
  let res: Response;
  try {
    res = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    throw new ApiError(0, "NETWORK", "Couldn't reach LabDesk to sign out. Check your connection and try again.");
  }
  if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null));
  accessToken = null;
}

function toApiError(status: number, body: unknown): ApiError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  return new ApiError(
    status,
    typeof error.code === "string" ? error.code : "HTTP_ERROR",
    typeof error.message === "string" ? error.message : `Request failed (${status})`,
    error.details,
  );
}

/** JSON request with the in-memory bearer token; retries once after a refresh on 401. */
export async function apiRequest<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const send = () =>
    fetch(path, {
      method: init.method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && (await refreshSession())) res = await send();
  } catch {
    throw new ApiError(0, "NETWORK", "Couldn't reach LabDesk. Check your connection and try again.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, body);
  if (!isRecord(body) || !("data" in body)) throw new ApiError(res.status, "BAD_RESPONSE", "Unexpected response");
  return body.data as T;
}
