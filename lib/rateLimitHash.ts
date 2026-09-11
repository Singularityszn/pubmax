import { createHash } from "node:crypto";

/**
 * sha256(salt:ip) - raw IPs never reach the database or logs.
 *
 * A PURE LEAF: `node:crypto` and one environment read, nothing else. It lives
 * here rather than in `lib/supabase.ts` so a route that only needs a limiter
 * key does not trace `@supabase/supabase-js` into its bundle. `lib/supabase.ts`
 * re-exports it, so there is ONE definition and ONE salt: two salted hashes
 * would drift and split one address across two buckets.
 */
export function hashIp(ip: string): string {
  // Default salt keeps dev working without env; set RATE_LIMIT_SALT in
  // production so hashes aren't computable from public code alone.
  const salt = process.env.RATE_LIMIT_SALT ?? "pubmax-rate-limit";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}
