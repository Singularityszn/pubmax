/*
 * PUBMAXXING service worker — offline resilience (issue #32, PRD § The Spill).
 * Pubs (especially cellars) have terrible signal; the map must survive it.
 *
 * Design rules (in order of importance):
 *  1. NEVER break a fresh deploy. Caches are keyed by a per-build VERSION
 *     (injected via the ?v= query on the registration URL — see
 *     components/OfflineReady.tsx and next.config.mjs). `activate` preserves
 *     trusted offline entries. See sw-plan-cache.js for Plan cache retirement.
 *  2. NEVER serve stale HTML for navigations. Navigations are network-first;
 *     the cache is only a fallback when the network is genuinely down, or
 *     when a shelved shell's network answer stalls past
 *     NAVIGATION_NETWORK_TIMEOUT_MS and the shelved copy is no older than
 *     that page's own revalidate window (SHELL_FRESH_FOR_MS), so it is no
 *     staler than the CDN itself may hand out.
 *  3. NEVER cache API responses (GET or POST). Last-train times and pint
 *     prices must be live or absent — stale data here is a lie (honesty rule).
 *     Non-GET requests are never intercepted at all.
 *
 * Strategy table:
 *   /data/*.json (slim index, POIs, heritage)
 *       → stale-while-revalidate (versioned, bounded)
 *   tiles.openfreemap.org + /_next/static/*
 *       → stale-while-revalidate, trimmed FIFO/LRU-ish at MAX_SWR_ENTRIES
 *   navigations
 *       → navigation preload (else fetch), network-first
 *         → shelved shell after a timeout, only while within its revalidate window
 *         → cached plan preview or fixed shell page → cached "/" → /offline.html
 *       A /map query that changes the document itself (MAP_DOCUMENT_QUERY_KEYS)
 *       is shelved under its exact query, never under the shared /map shell,
 *       and never answers from the shelf early.
 *   /api/* GETs
 *       → untouched (network-only); the app already renders honest
 *         empty/error states when these fail.
 */

const WORKER_URL = new URL(self.location.href);
const VERSION = WORKER_URL.searchParams.get("v")?.trim() || "local";
const CACHE_POLICY = WORKER_URL.searchParams.get("cache-policy");
const PRE_FIX_CACHE_POLICIES = new Set(["cache-write-coupled-v1", "write-safe-v1"]);

const PREFIX = "pubmax-sw-";
const DATA_CACHE = `${PREFIX}data-${VERSION}`;
const SWR_CACHE = `${PREFIX}swr-${VERSION}`;
// v2: a v1 shell family filed /map?place=, ?crawl= and the other document
// twins under the plain /map key, so a stalled or offline map navigation could
// get another town's document. Activation retires every v1 shell cache.
const SHELL_CACHE_PREFIX = `${PREFIX}shell-v2-`;
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${VERSION}`;
// Plan detail previews a crew opened earlier, so they reopen offline.
// Older navigation HTML can contain a private anchor in its inline Flight.
// A disjoint family prevents both migration and fallback from reading it.
const PLAN_CACHE_PREFIX = `${PREFIX}preview-plan-v2-`;
const PLAN_CACHE = `${PLAN_CACHE_PREFIX}${VERSION}`;
// The crawl offline pack: each stop's public /pubs/<id> page, saved when a
// crawl screen opens, so a stop still reads in a basement or on the Tube. The
// pages are fetched WITHOUT cookies, so the HTML is the page a stranger gets
// and no account is in it.
const CRAWL_PUB_CACHE_PREFIX = `${PREFIX}crawl-pubs-v1-`;
const CRAWL_PUB_CACHE = `${CRAWL_PUB_CACHE_PREFIX}${VERSION}`;
const CRAWL_PACK_MESSAGE = "pubmax:crawl-offline-pack";
const MAX_CRAWL_PACK_STOPS = 12;
const MAX_CRAWL_PUB_ENTRIES = 24;
const MAX_CRAWL_PACK_STYLESHEETS = 8;
// A saved stop younger than this is not fetched again, so reopening the crawl
// screen all night costs one fetch per stop, not one per visit.
const CRAWL_PUB_FRESH_FOR_MS = 6 * 60 * 60 * 1000;
const DATA_CACHE_FAMILY = {
  current: DATA_CACHE,
  prefix: `${PREFIX}data-`,
  copyEntries: false,
};
const CACHE_FAMILIES = [
  DATA_CACHE_FAMILY,
  { current: SWR_CACHE, prefix: `${PREFIX}swr-`, purgeTileHost: true },
  { current: SHELL_CACHE, prefix: SHELL_CACHE_PREFIX },
  { current: PLAN_CACHE, prefix: PLAN_CACHE_PREFIX },
  { current: CRAWL_PUB_CACHE, prefix: CRAWL_PUB_CACHE_PREFIX },
];

// Only new plan-cache writes depend on this versioned helper. Keep eligibility,
// migration and cached-preview reads in this worker so an import failure cannot
// discard valid offline previews or admit private HTML.
try {
  importScripts(`/sw-plan-cache.js?v=${VERSION}`);
} catch {
  // Existing eligible previews and fixed shells remain available offline.
}

// Tiles + hashed build assets can grow without bound (a long crawl-planning
// session pulls hundreds of tiles). Cache.keys() returns entries oldest-first,
// so trimming from the front is a cheap LRU-ish FIFO cap.
const MAX_SWR_ENTRIES = 200;
const MAX_TILE_ENTRIES = 150;
const MAX_DATA_ENTRIES = 350;

const TILE_HOST = "tiles.openfreemap.org";
const OFFLINE_URL = "/offline.html";
// Pages worth having offline: the landing shell, the map shell, and /tonight
// (the installed-app start_url, issue #439). Precache is best-effort
// (allSettled) — a failed precache must never fail the install. Opening the
// cache is part of the precache: a full origin can refuse it, and a worker
// whose install fails never activates, which would strand a reader on the
// pre-fix worker for exactly the storage pressure this one is built for.
const SHELL_URLS = ["/", "/map", "/tonight", OFFLINE_URL];
// /map query keys whose value changes the document, not just the camera. The
// server answers these from the per-request twin (lib/mapDocumentTwin.ts,
// MAP_DOCUMENT_QUERY_KEYS; __tests__/serviceWorkerCache.test.ts shelves
// every key from that list), so each one is its own page with its own shelf entry.
const MAP_DOCUMENT_QUERY_KEYS = ["place", "uk", "band", "crawl", "pubs", "card"];
// Each twin entry is one town or one share card a reader opened, so the shelf
// keeps only the most recent few.
const MAX_MAP_DOCUMENT_ENTRIES = 20;

// A stalled navigation (weak or captive signal) may serve its shelved shell
// after this long, while the live answer keeps loading and refreshes the
// shelf. Healthy CDN-held shells answer in well under a second.
const NAVIGATION_NETWORK_TIMEOUT_MS = 4000;
// How old a shelved shell may be and still answer a stalled navigation. Each
// is that page's own `revalidate` (app/page.tsx, app/map/page.tsx,
// app/tonight/page.tsx): the CDN may already hand out a copy that old, so the
// shelf is never staler than the network would be. /tonight carries prices
// and the London clock, so it gets five minutes, not an hour. A shell with no
// readable Date header never answers early; it waits for the network.
const SHELL_FRESH_FOR_MS = {
  "/": 60 * 60 * 1000,
  "/map": 60 * 60 * 1000,
  "/tonight": 5 * 60 * 1000,
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(
        SHELL_URLS.map((url) =>
          fetch(url, { cache: "no-cache" }).then((response) => {
            if (response.ok) return cache.put(url, response);
            return undefined;
          }),
        ),
      ),
    ).catch(() => undefined),
  );
  if (isPreFixActiveWorker()) {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.allSettled([
      ...CACHE_FAMILIES.map(migrateCacheFamily),
      retireLegacyPlanCaches(),
      retireLegacyShellCaches(),
      enableNavigationPreload(),
    ])
      .then(() => self.clients.claim()),
  );
});

// Navigation preload starts the network request while the worker boots, so
// worker start-up never sits in front of a navigation's first byte.
async function enableNavigationPreload() {
  await self.registration.navigationPreload?.enable();
}

function isPreFixActiveWorker() {
  const activeUrl = self.registration.active?.scriptURL;
  if (!activeUrl || !CACHE_POLICY) return false;
  try {
    const activePolicy = new URL(activeUrl).searchParams.get("cache-policy");
    return (
      activePolicy === null ||
      PRE_FIX_CACHE_POLICIES.has(activePolicy)
    );
  } catch {
    return false;
  }
}

async function retireLegacyPlanCaches() {
  const names = await caches.keys();
  await Promise.allSettled(
    names.filter((name) => name.startsWith(`${PREFIX}plan-`))
      .map((name) => caches.delete(name)),
  );
}

async function retireLegacyShellCaches() {
  const names = await caches.keys();
  await Promise.allSettled(
    names.filter((name) =>
      name.startsWith(`${PREFIX}shell-`) && !name.startsWith(SHELL_CACHE_PREFIX)
    ).map((name) => caches.delete(name)),
  );
}

async function cacheFamilyNames(currentName) {
  const family = CACHE_FAMILIES.find(({ current }) => current === currentName);
  if (!family) return [currentName];
  const names = await caches.keys();
  return [
    currentName,
    ...names
      .filter((name) => name.startsWith(family.prefix) && name !== currentName)
      .reverse(),
  ];
}

function isEligiblePlanCacheUrl(url) {
  return url.origin === self.location.origin &&
    /^\/plan\/[^/]+$/.test(url.pathname);
}

function isEligibleShellCacheUrl(url) {
  return url.origin === self.location.origin && SHELL_URLS.includes(url.pathname);
}

function isMapDocumentTwinUrl(url) {
  return url.origin === self.location.origin && url.pathname === "/map" &&
    MAP_DOCUMENT_QUERY_KEYS.some((key) => (url.searchParams.get(key) ?? "").trim());
}

// A shell is shelved under its path alone, except a /map document twin, which
// is shelved under its exact query so one town never answers for another.
function shellCacheKey(url) {
  return isMapDocumentTwinUrl(url) ? `${url.pathname}${url.search}` : url.pathname;
}

function isShelvedShellEntry(url) {
  return isEligibleShellCacheUrl(url) &&
    `${url.pathname}${url.search}` === shellCacheKey(url);
}

async function migrateCacheFamily({
  current,
  prefix,
  purgeTileHost = false,
  copyEntries = true,
}) {
  const names = await caches.keys();
  const oldNames = names.filter(
    (name) => name.startsWith(prefix) && name !== current,
  ).reverse();
  if (current === PLAN_CACHE || current === SHELL_CACHE) {
    const destination = await caches.open(current);
    for (const request of await destination.keys()) {
      const eligible = current === PLAN_CACHE
        ? isEligiblePlanCacheUrl(new URL(request.url))
        : isShelvedShellEntry(new URL(request.url));
      if (!eligible) await destination.delete(request);
    }
  }
  if (oldNames.length === 0) return;

  const destination = await caches.open(current);
  for (const name of oldNames) {
    const source = await caches.open(name);
    let covered = true;
    for (const request of await source.keys()) {
      if ((current === PLAN_CACHE && !isEligiblePlanCacheUrl(new URL(request.url))) ||
        (current === SHELL_CACHE && !isShelvedShellEntry(new URL(request.url)))) {
        if (!(await source.delete(request))) covered = false;
        continue;
      }
      if (purgeTileHost && new URL(request.url).hostname === TILE_HOST) {
        if (!(await source.delete(request))) covered = false;
        continue;
      }
      if (await destination.match(request)) continue;
      if (!copyEntries) {
        covered = false;
        continue;
      }
      const response = await source.match(request);
      if (!response) continue;
      try {
        await destination.put(request, response);
      } catch {
        covered = false;
      }
    }
    if (covered) await caches.delete(name);
  }
}

async function matchCacheFamily(currentName, request, options) {
  const requestUrl = new URL(
    typeof request === "string" ? request : request.url,
    self.location.origin,
  );
  if (currentName === SHELL_CACHE) {
    if (!isEligibleShellCacheUrl(requestUrl)) return undefined;
    // An ignoreSearch read would let a shelved twin answer the plain map, or
    // the plain map answer a twin. Every shelf entry sits at its exact key.
    request = shellCacheKey(requestUrl);
    options = { ...options, ignoreSearch: false };
  }
  const names = await cacheFamilyNames(currentName);
  const candidates =
    currentName === SWR_CACHE && requestUrl.hostname === TILE_HOST
      ? [currentName]
      : names;
  for (const name of candidates) {
    const response = await (await caches.open(name)).match(request, options);
    if (response) return response;
  }
  return undefined;
}

function isCrawlPubPath(pathname) {
  return /^\/pubs\/[a-z0-9][a-z0-9-]{0,119}$/.test(pathname);
}

// The venue ids a crawl screen asked for, cleaned: strings of the venue id
// shape only, no repeats, at most MAX_CRAWL_PACK_STOPS. Anything else in the
// message is ignored, so a page cannot steer the worker at another path.
function crawlPackPaths(data) {
  if (!data || data.type !== CRAWL_PACK_MESSAGE || !Array.isArray(data.venueIds)) return [];
  const paths = [];
  for (const id of data.venueIds) {
    if (typeof id !== "string") continue;
    const path = `/pubs/${id}`;
    if (!isCrawlPubPath(path) || paths.includes(path)) continue;
    paths.push(path);
    if (paths.length === MAX_CRAWL_PACK_STOPS) break;
  }
  return paths;
}

// The page's own stylesheets, so a saved stop is not bare HTML offline. Only
// hashed build CSS, which never changes under its URL.
function crawlPackStylesheets(html) {
  const found = [];
  for (const match of html.matchAll(/href="(\/_next\/static\/[^"?#]+\.css)"/g)) {
    if (!found.includes(match[1])) found.push(match[1]);
    if (found.length === MAX_CRAWL_PACK_STYLESHEETS) break;
  }
  return found;
}

async function storeCrawlPack(paths) {
  if (paths.length === 0) return;
  const cache = await caches.open(CRAWL_PUB_CACHE);
  const swr = await caches.open(SWR_CACHE);
  const stylesheets = [];
  for (const path of paths) {
    try {
      const url = new URL(path, self.location.origin).href;
      const saved = await cache.match(url);
      if (saved && shelvedShellAgeMs(saved, Date.now()) < CRAWL_PUB_FRESH_FOR_MS) continue;
      const response = await fetch(new Request(url, {
        credentials: "omit",
        headers: { Accept: "text/html" },
      }));
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || response.redirected || !type.includes("text/html")) {
        void response.body?.cancel().catch(() => {});
        continue;
      }
      for (const href of crawlPackStylesheets(await response.clone().text())) {
        if (!stylesheets.includes(href)) stylesheets.push(href);
      }
      await cache.put(url, response);
    } catch {
      // One stop failing must not cost the others.
    }
  }
  for (const href of stylesheets.slice(0, MAX_CRAWL_PACK_STYLESHEETS)) {
    try {
      const url = new URL(href, self.location.origin).href;
      if (await swr.match(url)) continue;
      await cachePutBestEffort(swr, url, await fetch(url, { credentials: "omit" }));
    } catch {
      // A missing stylesheet leaves a plainer page, never a missing one.
    }
  }
  await trimCache(CRAWL_PUB_CACHE, MAX_CRAWL_PUB_ENTRIES);
}

async function matchCrawlPubAcrossCaches(url) {
  if (url.origin !== self.location.origin || !isCrawlPubPath(url.pathname)) return undefined;
  for (const name of await cacheFamilyNames(CRAWL_PUB_CACHE)) {
    try {
      const response = await (await caches.open(name)).match(
        new URL(url.pathname, self.location.origin).href,
        { ignoreSearch: true },
      );
      if (response) return response;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function matchPlanNavigationAcrossCaches(url) {
  if (!isEligiblePlanCacheUrl(url)) {
    return undefined;
  }
  for (const name of await cacheFamilyNames(PLAN_CACHE)) {
    try {
      const cache = await caches.open(name);
      const response = await cache.match(url.pathname, { ignoreSearch: true });
      if (response) return response;
    } catch {
      continue;
    }
  }
  return undefined;
}

// Web Push payloads are always user-visible. Treat provider data as untrusted:
// copy only short strings and reduce click-through to a same-origin path. A
// malformed or empty push still shows a useful, honest fallback notification.
function pushText(value, fallback, maxLength) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function safeNotificationPath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/today";
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return "/today";
    // "/..//evil.example" resolves on our origin to the path "//evil.example",
    // which the click handler would read back as a protocol-relative URL.
    if (url.pathname.startsWith("//")) return "/today";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/today";
  }
}

self.addEventListener("message", (event) => {
  const paths = crawlPackPaths(event.data);
  if (paths.length > 0) event.waitUntil(storeCrawlPack(paths).catch(() => undefined));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    payload = {};
  }
  const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data
    : {};
  const url = safeNotificationPath(data.url);
  event.waitUntil(
    self.registration.showNotification(
      pushText(payload.title, "PUBMAXX", 80),
      {
        body: pushText(payload.body, "Your London brief is ready.", 240),
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: pushText(payload.tag, "pubmax-update", 80),
        data: { url },
      },
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeNotificationPath(event.notification.data?.url);
  const target = new URL(path, self.location.origin).toString();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const exact = windows.find((client) => client.url === target);
    if (exact) return exact.focus();

    const existing = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });
    if (existing) {
      if (typeof existing.navigate === "function") await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Rule 3: never intercept writes. POST/PUT/etc. go straight to the network.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  const sameOrigin = url.origin === self.location.origin;

  // API GETs (last-train, pint-drops, …): network-only. Not intercepted, so
  // a failure surfaces to the app's existing empty/error states — never a
  // stale price or a train that already left.
  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  // Navigations: network-first with an offline ladder.
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, request, url));
    return;
  }

  // Static data JSON: stale-while-revalidate for versioned-ish indices. Price
  // updates retain network-first behaviour because their observed-at claim has
  // a shorter honest window than the map index.
  if (sameOrigin && url.pathname.startsWith("/data/") && url.pathname.endsWith(".json")) {
    if (
      url.pathname.includes("/price_updates/") ||
      url.pathname.includes("/drink_price_updates/") ||
      url.pathname.includes("/food_price_updates/")
    ) {
      event.respondWith(networkFirstWithCache(event, request));
      return;
    }
    event.respondWith(
      staleWhileRevalidate(
        event,
        request,
        DATA_CACHE,
        MAX_DATA_ENTRIES,
        () => true,
        false,
        () => migrateCacheFamily(DATA_CACHE_FAMILY),
      ),
    );
    return;
  }

  // Map tiles / glyphs / sprites + Next's hashed static assets:
  // stale-while-revalidate with a capped cache.
  if (url.hostname === TILE_HOST || (sameOrigin && url.pathname.startsWith("/_next/static/"))) {
    const isTile = url.hostname === TILE_HOST;
    event.respondWith(
      staleWhileRevalidate(
        event,
        request,
        SWR_CACHE,
        isTile ? MAX_TILE_ENTRIES : MAX_SWR_ENTRIES,
        isTile ? (candidate) => new URL(candidate.url).hostname === TILE_HOST :
          (candidate) => new URL(candidate.url).pathname.startsWith("/_next/static/"),
      ),
    );
    return;
  }
  // Everything else: untouched.
});

function isCacheable(response) {
  if (!response || !response.ok || (response.type !== "basic" && response.type !== "cors")) {
    return false;
  }
  const cacheControl = response.headers?.get?.("cache-control")?.toLowerCase() || "";
  return !cacheControl.split(",").some((directive) => {
    const [name, value] = directive.trim().split("=", 2);
    return (
      ["no-store", "no-cache", "private", "must-revalidate", "proxy-revalidate"].includes(name) ||
      (["max-age", "s-maxage"].includes(name) && value?.trim() === "0")
    );
  });
}

function requestedVenueRevision(request) {
  const revision = new URL(request.url).searchParams.get("v")?.trim();
  return revision || (VERSION === "local" ? null : VERSION);
}

function expectedVenueManifestVersion(pathname) {
  if (pathname === "/data/venues_slim.manifest.json") return 2;
  if (/^\/data\/cities\/[^/]+\/venues_slim\.manifest\.json$/.test(pathname)) return 1;
  return null;
}

function isVenueShardPath(pathname) {
  return (
    pathname === "/data/venues_slim.json" ||
    /^\/data\/cities\/[^/]+\/venues_slim\.json$/.test(pathname) ||
    pathname === "/data/venues_slim.core.json" ||
    /^\/data\/venues_slim\.cell\..+\.json$/.test(pathname) ||
    /^\/data\/venues_slim\.(?!manifest|core|cell\.).+\.json$/.test(pathname) ||
    /^\/data\/cities\/[^/]+\/venues_slim\.core\.json$/.test(pathname)
  );
}

async function isCompatibleVenueManifest(request, response, options = {}) {
  const expectedVersion = expectedVenueManifestVersion(new URL(request.url).pathname);
  if (expectedVersion === null || !response) return true;
  const requestRevision = new URL(request.url).searchParams.get("v");
  if (!options.network && requestRevision && requestRevision !== VERSION) return false;
  try {
    const manifest = await response.clone().json();
    const expectedRevision = requestedVenueRevision(request);
    return (
      manifest?.version === expectedVersion &&
      Array.isArray(manifest.shards) &&
      (options.anyRevision || expectedRevision === null || manifest.revision === expectedRevision)
    );
  } catch {
    return false;
  }
}

async function isCompatibleVenueShard(request, response, options = {}) {
  const requestUrl = new URL(request.url);
  if (!isVenueShardPath(requestUrl.pathname) || !response) return true;
  const requestRevision = requestUrl.searchParams.get("v");
  if (!options.network && requestRevision && requestRevision !== VERSION) return false;
  if (!options.network && !requestRevision && VERSION !== "local") return false;
  try {
    const payload = await response.clone().json();
    const expectedRevision = requestedVenueRevision(request);
    return (
      (options.anyRevision || expectedRevision === null || payload?.revision === expectedRevision) &&
      Array.isArray(payload.rows)
    );
  } catch {
    return false;
  }
}

// A network venue pack that is well formed but names another revision is the
// pack the server holds around a deploy (old worker, new packs, or the
// reverse). It is never cached, but with no compatible cached copy the page
// gets it rather than an error, so the page can adopt it and report the skew
// (lib/slimShards.ts) instead of painting no pins.
async function isRevisionSkewedVenuePack(request, response) {
  const { pathname } = new URL(request.url);
  if (expectedVenueManifestVersion(pathname) === null && !isVenueShardPath(pathname)) return false;
  if (!response?.ok) return false;
  const options = { network: true, anyRevision: true };
  return (
    (await isCompatibleVenueManifest(request, response, options)) &&
    (await isCompatibleVenueShard(request, response, options))
  );
}

// Cache Storage is progressive enhancement. Safari may reject writes under
// storage pressure (especially while an update temporarily keeps two
// versioned cache sets). A valid network response must still reach its caller:
// cache.put() failure is never a network failure.
async function cachePutBestEffort(cache, request, response) {
  if (!isCacheable(response)) return false;
  try {
    await cache.put(request, response.clone());
    return true;
  } catch {
    return false;
  }
}

async function navigationNetworkResponse(event, request) {
  const preloaded = await event.preloadResponse;
  if (preloaded) return preloaded;
  return fetch(request);
}

function shelveNavigation(request, url, response) {
  // Keep the shell copies fresh so the offline fallback is the latest deploy
  // this browser has seen — but only for the pages we deliberately shelve.
  if (response.ok && isEligibleShellCacheUrl(url)) {
    const copy = response.clone();
    const twin = isMapDocumentTwinUrl(url);
    return caches.open(SHELL_CACHE)
      .then((cache) => cache.put(shellCacheKey(url), copy))
      .then(() => twin
        ? trimCache(
          SHELL_CACHE,
          MAX_MAP_DOCUMENT_ENTRIES,
          (candidate) => isMapDocumentTwinUrl(new URL(candidate.url)),
        )
        : undefined);
  }
  if (response.ok && isEligiblePlanCacheUrl(url) && self.planCache) {
    // Shelve the plan preview so a crew that opened the link earlier
    // can reopen it with no signal. Cache-on-success, bounded + LRU inside
    // the module; best-effort so it never delays the response.
    const copy = response.clone();
    return self.planCache.cachePlanNavigation(request, copy, url, PLAN_CACHE);
  }
  return undefined;
}

function shelvedShellAgeMs(response, now) {
  const date = Date.parse(response.headers?.get?.("date") ?? "");
  if (!Number.isFinite(date)) return Infinity;
  const age = Number(response.headers.get("age"));
  return Math.max(0, now - date) + (Number.isFinite(age) && age > 0 ? age * 1000 : 0);
}

// Resolves with the shelved shell if the network has not answered within
// NAVIGATION_NETWORK_TIMEOUT_MS and the shelf is fresh enough; otherwise with
// undefined, and the caller keeps waiting on the network.
async function stalledShellFallback(network, url) {
  // A twin renders per request, so no CDN copy bounds its shelf's age. A
  // stalled twin waits for the network like a page the worker never shelves.
  const freshForMs = url.origin === self.location.origin && !isMapDocumentTwinUrl(url)
    ? SHELL_FRESH_FOR_MS[url.pathname]
    : undefined;
  if (!freshForMs) return undefined;
  let timer;
  const timedOut = await Promise.race([
    network.then(() => false, () => false),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(true), NAVIGATION_NETWORK_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (!timedOut) return undefined;
  const shelved = await matchCacheFamily(SHELL_CACHE, url.href, {
    ignoreSearch: true,
  });
  if (!shelved || shelvedShellAgeMs(shelved, Date.now()) > freshForMs) {
    return undefined;
  }
  return shelved;
}

async function handleNavigation(event, request, url) {
  const network = navigationNetworkResponse(event, request);
  // Registered before any await so the copy is cloned before the page reads
  // the body, and so a live answer that lands after a stalled-shell fallback
  // still refreshes the shelf.
  event.waitUntil(
    network
      .then((response) => shelveNavigation(request, url, response))
      .catch(() => undefined),
  );
  try {
    const stalled = await stalledShellFallback(network, url);
    if (stalled) return stalled;
    return await network;
  } catch {
    // The native entry document is never shelved, and the cached root served
    // under its URL would read as a deep link. Hand it to the root ladder.
    if (url.pathname === "/app-entry") {
      return Response.redirect(new URL("/", url).href, 302);
    }
    // Offline, a plan detail page reopens from its cached preview before the
    // generic shell ladder. Member details still require their live API.
    const plan = await matchPlanNavigationAcrossCaches(url);
    if (plan) return plan;
    // A crawl stop saved by the offline pack.
    const pub = await matchCrawlPubAcrossCaches(url);
    if (pub) return pub;
    const exact = await matchCacheFamily(SHELL_CACHE, url.href, {
      ignoreSearch: true,
    });
    if (exact) return exact;
    const home = await matchCacheFamily(SHELL_CACHE, "/", {
      ignoreSearch: true,
    });
    if (home) return home;
    const offline = await matchCacheFamily(SHELL_CACHE, OFFLINE_URL, {
      ignoreSearch: true,
    });
    if (offline) return offline;
    return new Response("You're offline and nothing is cached yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/** Prefer network for freshness-sensitive JSON; fall back to cache when offline. */
async function networkFirstWithCache(event, request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      event.waitUntil(
        cachePutBestEffort(cache, request, response).then(async (stored) => {
          if (stored) await migrateCacheFamily(DATA_CACHE_FAMILY);
        }),
      );
    }
    return response;
  } catch {
    const cached = await matchCacheFamily(DATA_CACHE, request, {
      ignoreSearch: true,
    });
    if (cached) return cached;
    return new Response("[]", {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function staleWhileRevalidate(
  event,
  request,
  cacheName = SWR_CACHE,
  maxEntries = MAX_SWR_ENTRIES,
  belongsToCache = () => true,
  preferNetworkForLegacy = false,
  afterStore = async () => undefined,
) {
  const cache = await caches.open(cacheName);
  const current = await cache.match(request);
  const cachedCandidate = current ?? await matchCacheFamily(cacheName, request);
  const cachedManifest = await isCompatibleVenueManifest(request, cachedCandidate);
  const cachedShard = await isCompatibleVenueShard(request, cachedCandidate);
  const cached = cachedManifest && cachedShard ? cachedCandidate : undefined;
  let skewed;
  const network = fetch(request)
    .then(async (response) => {
      if (
        (await isCompatibleVenueManifest(request, response, { network: true })) &&
        (await isCompatibleVenueShard(request, response, { network: true }))
      ) {
        return response;
      }
      if (await isRevisionSkewedVenuePack(request, response)) skewed = response;
      return undefined;
    })
    .catch(() => undefined);
  const update = network.then(async (response) => {
    if (!isCacheable(response)) return;
    const stored = await cachePutBestEffort(cache, request, response);
    if (!stored) return;
    await afterStore();
    try {
      await trimCache(cacheName, maxEntries, belongsToCache);
    } catch {
      // Trimming is best-effort for the same reason as the write.
    }
  });

  if (cached && (!preferNetworkForLegacy || current)) {
    event.waitUntil(update);
    return cached;
  }
  const fresh = await network;
  event.waitUntil(update);
  if (fresh) return fresh;
  if (cached) return cached;
  if (skewed) return skewed;
  return Response.error();
}

// FIFO trim: Cache.keys() yields insertion order, so deleting from the front
// drops the oldest-written entries first.
async function trimCache(cacheName, maxEntries, belongsToCache = () => true) {
  const cache = await caches.open(cacheName);
  const keys = (await cache.keys()).filter((key) => {
    try {
      return belongsToCache(key);
    } catch {
      return false;
    }
  });
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}
