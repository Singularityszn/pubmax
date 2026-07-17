// Public API error helpers. THE LOCAL uses the flat response while shipped
// Heritage consumers keep the legacy nested response below.

const NO_STORE = "no-store";

export type PublicApiError = {
  /** Back-compatible human-readable message for existing clients. */
  error: string;
  code: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type PublicApiErrorOptions = {
  retryable?: boolean;
  details?: Record<string, unknown>;
  /** Additive legacy siblings only; canonical error fields always win. */
  compatibilityFields?: Record<string, unknown>;
  headers?: HeadersInit;
};

/**
 * Flat public error response used by THE LOCAL routes.
 *
 * Keep this separate from the legacy nested `apiError()` response below:
 * Heritage still has a shipped consumer for that envelope, while THE LOCAL's
 * public contract is the additive flat `{ error, code, retryable, details? }`
 * shape.
 */
export function publicApiError(
  error: string,
  code: string,
  status: number,
  options: PublicApiErrorOptions = {},
): Response {
  const headers = new Headers(options.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", NO_STORE);
  const body: PublicApiError & Record<string, unknown> = {
    ...(options.compatibilityFields ?? {}),
    error,
    code,
    retryable: options.retryable ?? false,
    ...(options.details ? { details: options.details } : {}),
  };
  return Response.json(body, { status, headers });
}

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
