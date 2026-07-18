// Per-IP rate limiting for the /api/hygiene proxy surface.
//
// Every uncached /api/hygiene request forwards to the third-party FSA FHRS
// upstream. The `name`/`postcode` params are attacker-varied and routinely miss
// the per-instance TTL cache in lib/foodHygiene.ts, so without a floor here an
// unauthenticated caller could drive unbounded outbound fan-out against a public
// service. ONE shared budget covers the whole surface per IP.
//
// Same idiom as lib/citymcpRateLimit.ts / lib/lastRideRateLimit.ts: isLimited
// (lib/pintDrops) with clientIp + hashIp (lib/supabase) for keying — durable via
// Supabase when configured, in-memory fallback otherwise.

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

const HYGIENE_RATE_LIMIT = 60;
const HYGIENE_RATE_WINDOW_MS = 60_000;

/** Shared ~60/min-per-IP budget across the /api/hygiene surface. */
export async function isHygieneLimited(request: Request): Promise<boolean> {
  const key = `hygiene:${hashIp(clientIp(request))}`;
  return isLimited(key, key, HYGIENE_RATE_LIMIT, HYGIENE_RATE_WINDOW_MS);
}
