const DEFAULT_AFTER_LOGIN = "/scan";

/**
 * The post-login destination from `?next=`. Only same-origin paths are
 * allowed: "//host" and "/\host" are protocol-relative to a browser, so they
 * would make /login an open redirect.
 */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_AFTER_LOGIN;
  }
  return value;
}

/** /login, remembering where to come back to. */
export function loginPath(returnTo: string): string {
  return `/login?next=${encodeURIComponent(returnTo)}`;
}
