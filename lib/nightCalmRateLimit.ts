// Per-IP rate limiting for /api/night-calm.
//
// The route fans out to the keyless data.police.uk upstream on a cache miss with
// an attacker-varied `area` param. The per-area/per-month cache absorbs repeats,
// but a floor here stops an unauthenticated caller cycling areas to drive
// unbounded outbound fetches. Same idiom as lib/citymcpRateLimit.ts.

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

const NIGHT_CALM_RATE_LIMIT = 60;
const NIGHT_CALM_RATE_WINDOW_MS = 60_000;

/** ~60/min-per-IP budget for the night-calm surface. */
export async function isNightCalmLimited(request: Request): Promise<boolean> {
  const key = `night-calm:${hashIp(clientIp(request))}`;
  return isLimited(key, key, NIGHT_CALM_RATE_LIMIT, NIGHT_CALM_RATE_WINDOW_MS);
}
