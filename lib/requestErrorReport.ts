import { log } from "@/lib/log";

// The one line an unhandled server error leaves (Next's `onRequestError`, wired
// in `instrumentation.ts`). Before this, a route, render or action that threw
// reached only Next's own stderr dump: no structured event, so no alert through
// `lib/alertSink.ts`, and nothing left once Vercel's short log retention ran out.
//
// Privacy, the `lib/routeObservability.ts` rule: the route is Next's file-path
// TEMPLATE (`/api/profiles/[handle]`), never the request path, so a handle, an
// id or a query string never reaches the line. The error contributes its type
// and React's digest, never its message, because a PostgREST message can echo
// row values. `x-vercel-id` is the platform's request id, the one correlation
// id that joins this line to the Vercel request log.

export type RequestErrorRequest = {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
};

export type RequestErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
};

const MAX_FIELD = 120;

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ? raw.slice(0, MAX_FIELD) : undefined;
}

function errorType(error: unknown): string {
  return error instanceof Error && error.name ? error.name.slice(0, MAX_FIELD) : "Error";
}

function errorDigest(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("digest" in error)) return undefined;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" ? digest.slice(0, MAX_FIELD) : undefined;
}

export function reportRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
): void {
  const vercelId = firstHeader(request.headers["x-vercel-id"]);
  const digest = errorDigest(error);
  log("error", "request.unhandled", {
    route: (context.routePath ?? "unknown").slice(0, MAX_FIELD),
    routeType: context.routeType ?? "unknown",
    method: (request.method ?? "GET").slice(0, 10),
    errorType: errorType(error),
    ...(digest ? { digest } : {}),
    ...(vercelId ? { vercelId } : {}),
  });
}
