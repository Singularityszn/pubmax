// Standardized JSON error Response for API routes.
//
// Every hand-rolled error body in these routes invents its own shape
// (`{ error: "…" }`, `{ error, place: null }`, a bare "Too many requests"
// string, …). This helper gives 4xx/5xx failures ONE machine-readable shape —
// `{ error: { code, message, status } }` with the matching HTTP status — so a
// caller can branch on a stable `code` instead of string-matching prose.
//
// Introduced with the CityMCP GET rate limiter (the 429s below use it); adopt
// incrementally in other routes rather than rewriting them all at once.

const NO_STORE = "no-store";

export type PublicApiError = {
  /** Back-compatible human-readable message for existing clients. */
  error: string;
  code: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    status: number;
  };
}

export function apiError(
  code: string,
  message: string,
  status: number,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", NO_STORE);
  }
  const body: ApiErrorBody = { error: { code, message, status } };
  return Response.json(body, { ...init, status, headers });
}
