// POST /api/events — self-owned, privacy-first analytics ingest (Wave D · D0).
//
// The client beacon (lib/analytics.ts) posts a single registry-known event with
// allow-listed primitive props. This route re-validates against the SAME
// registry (never trust the client), drops anything unknown or unsafe, and
// records the event. When POSTHOG_PROJECT_API_KEY is configured, the same
// sanitized event is forwarded to PostHog's EU ingest with a pseudonymous
// browser-generated id and person-profile processing disabled. No IP, account,
// handle, free text, query string, or precise location is added by this route.
//
// Events are also emitted as a structured server log line
// (`[pubmax-analytics] …`) for release diagnosis. Both sinks fail soft:
// malformed input or a provider outage returns 204 and never breaks a journey.
//
// This is a public, unauthenticated endpoint, so it also carries its own
// abuse guards: a per-hashed-IP rate limit (isEventsRateLimited) and a
// server-side DNT check, both below. Neither ever stores or logs the raw IP —
// see lib/eventsRateLimit.ts — so the "no identifier is stored" guarantee
// above still holds; the hash exists only for the lifetime of the counter
// check.

import { sanitizeEvent } from "@/lib/analyticsEvents";
import { isAnonymousAnalyticsId } from "@/lib/analyticsIdentity";
import { isEventsRateLimited } from "@/lib/eventsRateLimit";
import { capturePosthogEvent } from "@/lib/posthogServer";

export const runtime = "nodejs";

// Beacon payloads are tiny; anything larger is not one of ours.
const MAX_BODY_BYTES = 2_000;

const STATIC_ANALYTICS_SURFACES = new Set([
  "/", "/map", "/tonight", "/moment", "/stories", "/you", "/pal", "/plan",
]);

export function analyticsSurfaceFromPath(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 120) return null;
  const pathname = path.split("?")[0];
  if (STATIC_ANALYTICS_SURFACES.has(pathname)) return pathname;
  if (/^\/plan\/[^/]+$/.test(pathname)) return "/plan/[id]";
  if (/^\/u\/[^/]+$/.test(pathname)) return "/u/[handle]";
  if (/^\/messages\/[^/]+$/.test(pathname)) return "/messages/[id]";
  if (/^\/rounds\/[^/]+$/.test(pathname)) return "/rounds/[code]";
  return null;
}

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

    const { name, props, path, anonymousId, analyticsConsent } = body as {
      name?: unknown;
      props?: unknown;
      path?: unknown;
      anonymousId?: unknown;
      analyticsConsent?: unknown;
    };
    if (typeof name !== "string") return noContent();

    const event = sanitizeEvent(
      name,
      props && typeof props === "object" ? (props as Record<string, unknown>) : undefined,
    );
    if (!event) return noContent();
    // Consent is required for every destination, including the structured
    // release log. A direct POST cannot bypass the browser consent gate.
    if (analyticsConsent !== true || !isAnonymousAnalyticsId(anonymousId)) {
      return noContent();
    }

    // Coarse path only (own-origin pathname), no query, capped — never a URL
    // that could carry a token.
    const safePath = analyticsSurfaceFromPath(path);

    // Structured, PII-free log line. Server owns the timestamp.
    console.log(
      `[pubmax-analytics] ${JSON.stringify({
        name: event.name,
        props: event.props,
        path: safePath,
        ts: new Date().toISOString(),
      })}`,
    );

    // A provider outage must not create retries or block navigation. Awaiting a
    // short, bounded request keeps delivery reliable in serverless runtimes.
    await capturePosthogEvent({ event, path: safePath, anonymousId, analyticsConsent });

    return noContent();
  } catch {
    return noContent();
  }
}
