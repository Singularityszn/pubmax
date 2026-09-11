/**
 * The sliding-window budget the `/ingest` PostHog proxy spends, and nothing
 * else (Astra P2-1).
 *
 * It is a LEAF on purpose: it imports nothing, so the busiest public route does
 * not pull the Supabase client, the demo Pint Drop seeds and the rest of that
 * graph into its bundle to reach a counter.
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
const windows = new Map<string, number[]>();
let sweptAt = 0;

function sweepExpiredKeys(now: number, windowMs: number): void {
  if (now - sweptAt < windowMs) return;
  sweptAt = now;
  for (const [key, hits] of windows) {
    if (hits.every((hit) => now - hit >= windowMs)) windows.delete(key);
  }
}

/** True when `key` has already spent `limit` hits inside `windowMs`. */
export function ingestRateLimited(
  key: string,
  now: number,
  limit: number,
  windowMs: number,
): boolean {
  sweepExpiredKeys(now, windowMs);
  const hits = (windows.get(key) ?? []).filter((hit) => now - hit < windowMs);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return true;
  }
  hits.push(now);
  windows.set(key, hits);
  return false;
}

/** Tracked keys and the hits each one still holds, for the fences to read. */
export function ingestLimiterSnapshot(): Record<string, number> {
  return Object.fromEntries([...windows].map(([key, hits]) => [key, hits.length]));
}
