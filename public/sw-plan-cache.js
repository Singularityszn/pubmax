/*
 * PUBMAXXING public plan-preview cache writes.
 *
 * A /plan/<id> page opened with signal can reopen without it. /p/<id> is a
 * Pint Drop, and nested plan routes such as /plan/<id>/recap are excluded.
 *
 * The plan page renders a privacy-safe preview in HTML. Member details are
 * fetched separately through the capability-gated API and are not cached here.
 *
 * It lives in its own file, loaded by public/sw.js via
 *   importScripts("/sw-plan-cache.js?v=" + VERSION)
 *
 * Cache identity/eviction:
 *  - The cache name is owned by sw.js (PREFIX + "preview-plan-v2-" + VERSION)
 *    and passed in, so it is versioned and eligible entries are migrated by
 *    sw.js during activate().
 *  - The older PREFIX + "plan-" family is retired: its HTML can carry private
 *    plan details. sw.js never reads from it and attempts best-effort deletion
 *    during activate().
 *  - Keyed by pathname (like the shell cache) so a plan reopens regardless of
 *    ?vibe=/utm query, and one plan is never stored twice.
 *  - Bounded to the last MAX_PLAN_ENTRIES plans, LRU-ish: Cache.put replaces
 *    then appends, so a re-opened plan moves to the end and trimming from the
 *    front (Cache.keys() is oldest-first) drops the least-recently-seen plan.
 *
 * Never caches non-GET or /api/* — that gating lives in sw.js before a
 * navigation ever reaches here; isPlanPath is an extra guard, not the only one.
 */
(function (scope) {
  "use strict";

  const MAX_PLAN_ENTRIES = 10;

  // Only the plan detail page has a public preview suitable for offline HTML.
  function isPlanPath(pathname) {
    return /^\/plan\/[^/]+$/.test(pathname);
  }

  // Which cache keys to delete to keep at most maxEntries. Cache.keys() yields
  // oldest-first, so the surplus at the FRONT is the least-recently-cached.
  // Pure + synchronous so the eviction rule is unit-testable without a Cache.
  function planEvictionKeys(keys, maxEntries) {
    if (!Array.isArray(keys) || keys.length <= maxEntries) return [];
    return keys.slice(0, keys.length - maxEntries);
  }

  async function trimPlanCache(cacheName, maxEntries) {
    const cache = await scope.caches.open(cacheName);
    const keys = await cache.keys();
    const doomed = planEvictionKeys(keys, maxEntries);
    await Promise.all(doomed.map((key) => cache.delete(key)));
  }

  // Store a successful plan navigation. Keyed by pathname so it is query- and
  // duplicate-proof, then trimmed to the LRU bound. Best-effort: a cache write
  // failing must never break the response the user is already being handed.
  async function cachePlanNavigation(request, response, url, cacheName) {
    if (!response || !response.ok || !isPlanPath(url.pathname)) return;
    try {
      const cache = await scope.caches.open(cacheName);
      await cache.put(url.pathname, response.clone());
      await trimPlanCache(cacheName, MAX_PLAN_ENTRIES);
    } catch {
      // swallow: caching is an optimisation, not a correctness requirement
    }
  }

  const api = {
    MAX_PLAN_ENTRIES,
    isPlanPath,
    planEvictionKeys,
    trimPlanCache,
    cachePlanNavigation,
  };

  // Runtime: expose on the SW global for public/sw.js to call.
  if (scope) scope.planCache = api;
  // Test: allow a Node/vitest import of the pure helpers (no self required).
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : undefined);
