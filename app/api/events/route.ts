// POST /api/events — self-owned, privacy-first analytics ingest (Wave D · D0).
//
// The client beacon (lib/analytics.ts) posts a single registry-known event with
// allow-listed primitive props. This route re-validates against the SAME
// registry (never trust the client), drops anything unknown or unsafe, and
// records the event. There is no third-party collector and no identifier is
// read or stored — not the IP, not a cookie, nothing that ties an event to a
// person.
//
// Durable storage is deferred to the Supabase re-auth gate; until then events
// are emitted as a structured server log line (`[pubmax-analytics] …`) that
// Vercel's log drain captures, which is enough to prove the metric spine works
// end-to-end. Always fail-soft: malformed input returns 204, never a 4xx that
// would tempt the client to retry.
//
// This is a public, unauthenticated endpoint, so it also carries its own
// abuse guards: a per-hashed-IP rate limit (isEventsRateLimited) and a
// server-side DNT check, both below. Neither ever stores or logs the raw IP —
// see lib/eventsRateLimit.ts — so the "no identifier is stored" guarantee
// above still holds; the hash exists only for the lifetime of the counter
// check.

import { sanitizeEvent } from "@/lib/analyticsEvents";
import { isEventsRateLimited } from "@/lib/eventsRateLimit";

export const runtime = "nodejs";

// Beacon payloads are tiny; anything larger is not one of ours.
const MAX_BODY_BYTES = 2_000;

function noContent(): Response {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: Request): Promise<Response> {
  try {
    // Server-side Do Not Track: the client beacon (lib/analytics.ts) already
    // checks navigator.doNotTrack before sending, but a direct POST (curl,
    // a script, a replay) bypasses a client-only check. Honor the header
    // itself so DNT is enforced at the trust boundary, not just in the UI.
    if (req.headers.get("dnt") === "1") return noContent();

    // Every bad-input path below returns 204, never 4xx/429 — same fail-soft
    // convention as the rest of this route. A 429 would (a) hand an attacker
    // a signal to back off and retry slower rather than just stop, and (b)
    // the client fire-and-forgets the beacon anyway, so there's no one home
    // to read a status code.
    if (await isEventsRateLimited(req)) return noContent();

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return noContent();

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return noContent();
    }
    if (!body || typeof body !== "object") return noContent();

    const { name, props, path } = body as {
      name?: unknown;
      props?: unknown;
      path?: unknown;
    };
    if (typeof name !== "string") return noContent();

    const event = sanitizeEvent(
      name,
      props && typeof props === "object" ? (props as Record<string, unknown>) : undefined,
    );
    if (!event) return noContent();

    // Coarse path only (own-origin pathname), no query, capped — never a URL
    // that could carry a token.
    const safePath =
      typeof path === "string" && path.startsWith("/") && path.length <= 120
        ? path.split("?")[0]
        : null;

    // Structured, PII-free log line. Server owns the timestamp.
    console.log(
      `[pubmax-analytics] ${JSON.stringify({
        name: event.name,
        props: event.props,
        path: safePath,
        ts: new Date().toISOString(),
      })}`,
    );

    return noContent();
  } catch {
    return noContent();
  }
}
