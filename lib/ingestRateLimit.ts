/**
 * The sliding-window budget the `/ingest` PostHog proxy spends, and nothing
 * else.
 *
 * WHY IT EXISTS: `/ingest` was an unauthenticated PostHog proxy with no budget
 * at all, so a scripted loop could post 1 MB a request into the billed EU
 * project for as long as it liked. (Astra P2-1. The Astra plan and its review
 * live in the captain's workspace and are not files in this repository, so
 * every site that acted on a finding says what the finding was, in words.)
 *
 * It is a LEAF on purpose: it imports nothing, so reaching a counter no longer
 * pulls `@/lib/pintDrops` and its Pint Drop seeds, cities, drink measures and
 * logging into the route's graph. The route reads its caller's address through
 * `@/lib/clientIpTrust` and hashes it through `@/lib/rateLimitHash`, both pure
 * leaves, so `@supabase/supabase-js` is no longer traced into the bundle of the
 * route every browser event and asset fetch hits. Nothing on this path makes a
 * Supabase CALL either, so a Supabase outage
 * cannot wall the error telemetry that reports it.
 *
 * It differs from the shared limiter in `lib/pintDrops.ts` in the two ways the
 * flood it exists for makes reachable:
 *   1. IT COMPARES BEFORE IT RECORDS. An address that is already refused does
 *      not append another timestamp, so its window cannot grow past the limit
 *      and each later refusal costs the same as the first.
 *   2. IT DROPS AN EMPTY KEY. Once every hit in a window has expired the key
 *      leaves the map, so a flood of distinct addresses cannot leave one
 *      permanent entry per address for the life of the instance. The sweep runs
 *      at most once a window, so it costs one pass a window rather than one a
 *      request.
 */
type LimiterWindows = Map<string, number[]>;

const windows: LimiterWindows = new Map();
const sweptAt = new WeakMap<LimiterWindows, number>();

function sweepExpiredKeys(store: LimiterWindows, now: number, windowMs: number): void {
  if (now - (sweptAt.get(store) ?? 0) < windowMs) return;
  sweptAt.set(store, now);
  for (const [key, hits] of store) {
    if (hits.every((hit) => now - hit >= windowMs)) store.delete(key);
  }
}

/**
 * True when `key` has already spent `limit` hits inside `windowMs`. `store`
 * defaults to the per-instance window every caller shares; a caller may pass
 * its own so a budget can be spent and inspected in isolation.
 */
export function ingestRateLimited(
  key: string,
  now: number,
  limit: number,
  windowMs: number,
  store: LimiterWindows = windows,
): boolean {
  sweepExpiredKeys(store, now, windowMs);
  const hits = (store.get(key) ?? []).filter((hit) => now - hit < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    return true;
  }
  hits.push(now);
  store.set(key, hits);
  return false;
}
