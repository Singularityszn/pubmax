// Per-IP rate limiting for the public Out read (/api/out).
//
// The route is public and unauthenticated and issues a Postgres RPC per
// request. The CDN keys on the whole URL, so query params the route ignores
// still mint fresh cache keys and every one of them reaches the database. It
// gets its OWN key/budget, the way the events and whats-on surfaces do, so it
// can never share (and prematurely exhaust) theirs.

import { makeIpRateLimiter } from "@/lib/ipRateLimit";

/** ~60/min-per-IP budget for the public /api/out read. */
export const isOutLimited = makeIpRateLimiter("out");
