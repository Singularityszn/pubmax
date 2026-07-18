// Per-IP rate limiting for the request-time events surface (/api/events/tonight).
//
// That route fans out to a third-party API (Eventbrite) on an uncached miss,
// so — exactly like the CityMCP proxy surface (lib/citymcpRateLimit.ts) — an
// unauthenticated caller must not be able to drive unbounded outbound fan-out.
// It gets its OWN key/budget so it never shares (and prematurely exhausts) the
// CityMCP or whats-on budgets.
//
// Same idiom as lib/citymcpRateLimit.ts: isLimited (lib/pintDrops.ts) with
// clientIp + hashIp (lib/supabase.ts) — durable via Supabase when configured,
// in-memory fallback otherwise.

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

const EVENTS_LIVE_RATE_LIMIT = 60;
const EVENTS_LIVE_RATE_WINDOW_MS = 60_000;

/** ~60/min-per-IP budget for the request-time /api/events/tonight surface. */
export async function isEventsLiveLimited(request: Request): Promise<boolean> {
  const key = `events-live:${hashIp(clientIp(request))}`;
  return isLimited(key, key, EVENTS_LIVE_RATE_LIMIT, EVENTS_LIVE_RATE_WINDOW_MS);
}
