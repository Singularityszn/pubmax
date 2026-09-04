// Per-IP rate limiting for POST /api/client-error.
//
// That route is public and unauthenticated by design: a WebView that has just
// thrown cannot be asked to prove anything first. It gets its OWN key and
// budget rather than sharing the analytics one, because a page in a crash loop
// must not exhaust the events budget for the same IP, and because a shared
// budget makes one hammered surface silence the other.
//
// The budget is deliberately small. One reader's browser reports a handful of
// errors a minute at worst; a caller past this floor is not reporting errors.

import { makeIpRateLimiter } from "@/lib/ipRateLimit";

/** ~20/min-per-IP budget for the client error report surface. */
export const isClientErrorLimited = makeIpRateLimiter("client-error", 20, 60_000);
