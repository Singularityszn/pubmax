// Per-IP rate limiting for the public Out listing surface (/out and /api/out).
//
// The document reads the served listings store and never asks a live provider.
// The API reads the same store, asks the live event providers on a cache miss
// and reads open plans through a Postgres RPC. Both entries spend ONE shared
// budget, so an unauthenticated caller cannot double its reads by switching
// between them or drive unbounded outbound fan-out. Out gets its OWN key/budget:
// /api/events/tonight (lib/eventsLiveRateLimit.ts) is a different surface
// talking to a different upstream, and sharing a budget means one hammered
// surface exhausts the other for the same IP.

import { makeIpRateLimiter } from "@/lib/ipRateLimit";

// Next bundles the document and API separately. Keep one limiter closure per
// process so both bundles spend the same in-memory fallback budget.
const outRateLimitGlobal = globalThis as typeof globalThis & {
  __pubmaxOutRateLimiter?: ReturnType<typeof makeIpRateLimiter>;
};

/** ~60/min-per-IP budget shared by the public Out document and API. */
export const isOutLimited = outRateLimitGlobal.__pubmaxOutRateLimiter ??=
  makeIpRateLimiter("out-listings");
