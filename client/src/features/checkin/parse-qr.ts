import type { CheckinPayload } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads r / sig from a check-in URL's query (the /checkin deep link). */
export function payloadFromParams(params: URLSearchParams): CheckinPayload | null {
  const resourceId = params.get("r");
  const sig = params.get("sig");
  return resourceId && sig && UUID.test(resourceId) ? { resourceId, sig } : null;
}

/**
 * A printed LabDesk QR encodes `<app>/checkin?r=<resourceId>&sig=<hmac>`
 * (CLAUDE.md §7). Returns null for anything else — the server still verifies
 * the signature; this only rejects codes that obviously aren't ours.
 */
export function parseCheckinQr(text: string): CheckinPayload | null {
  try {
    const url = new URL(text.trim());
    return url.pathname.replace(/\/+$/, "") === "/checkin" ? payloadFromParams(url.searchParams) : null;
  } catch {
    return null;
  }
}
