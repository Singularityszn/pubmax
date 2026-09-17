// POST /api/client-error - the minimal, redacted, first-party client error
// report (GAP 16 of the mobile store-readiness audit).
//
// WHY IT EXISTS. The whole app runs inside a WebView on somebody else's phone.
// A JavaScript exception there produced nothing anybody would ever see: Vercel
// logs the server, and the PostHog `$exception` lane is behind the analytics
// consent gate, which is default off. After a staged store rollout the only
// week-one signal would have been store reviews.
//
// WHAT IT IS NOT. It is not analytics and it must never become analytics. It
// carries no person, no device id, no consent identity and no free text a
// reader typed - only an error class, a redacted message, a closed route
// template and which shell threw. That is why it sits outside the consent gate
// and why it needs no new answer on either privacy form.
//
// WHAT IT DOES WITH A REPORT. Writes one structured server log line and
// nothing else. No table, no store, no processor. The report is rebuilt
// SERVER-SIDE through the same lib/clientErrorReport.ts the browser used, so a
// direct POST cannot describe itself differently from the reporter, and a
// message is redacted a second time on arrival because a route may never trust
// what a caller sends.
//
// Like /api/events this answers 204 to everything, including its own
// refusals: a browser that has already thrown has nobody home to read a
// status code, and a 429 would only tell an abusive caller to slow down rather
// than stop. That is why no publicApiError envelope appears here - there is no
// 4xx or 5xx JSON body to put in one.

import {
  buildClientErrorReport,
  CLIENT_ERROR_MAX_BODY_BYTES,
} from "@/lib/clientErrorReport";
import { isClientErrorLimited } from "@/lib/clientErrorRateLimit";

export const runtime = "nodejs";

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  try {
    if (await isClientErrorLimited(req)) return noContent();

    const raw = await req.text();
    if (raw.length > CLIENT_ERROR_MAX_BODY_BYTES) return noContent();

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return noContent();
    }
    if (!body || typeof body !== "object") return noContent();

    const { kind, name, message, path, shell } = body as Record<string, unknown>;
    const report = buildClientErrorReport({ kind, name, message, path, shell });
    if (!report) return noContent();

    // The server owns the timestamp; a browser clock is not evidence.
    console.warn(
      `[pubmax-client-error] ${JSON.stringify({ ...report, ts: new Date().toISOString() })}`,
    );

    return noContent();
  } catch {
    return noContent();
  }
}
