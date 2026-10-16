// Per-IP rate limiting for the public Out listing surface (/out and /api/out).
//
// That route fans out to Ticketmaster / Skiddle on an uncached miss, and each
// request also issues a Postgres RPC for open plans. An unauthenticated caller
// must not drive unbounded outbound fan-out. It gets its OWN key/budget:
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
