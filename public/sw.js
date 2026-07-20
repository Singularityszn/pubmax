/*
 * PUBMAXXING service worker — offline resilience (issue #32, PRD § The Spill).
 * Pubs (especially cellars) have terrible signal; the map must survive it.
 *
 * Design rules (in order of importance):
 *  1. NEVER break a fresh deploy. Caches are keyed by a per-build VERSION
 *     (injected via the ?v= query on the registration URL — see
 *     components/OfflineReady.tsx and next.config.mjs). `activate` deletes
 *     every pubmax cache that doesn't belong to this version.
 *  2. NEVER serve stale HTML for navigations. Navigations are network-first;
 *     the cache is only a fallback when the network is genuinely down.
 *  3. NEVER cache API responses (GET or POST). Last-train times and pint
 *     prices must be live or absent — stale data here is a lie (honesty rule).
 *     Non-GET requests are never intercepted at all.
 *
 * Strategy table:
 *   /data/*.json (slim index, pint dataset, price updates, POIs, heritage)
 *       → cache-first + background revalidate (bounded set, ~static per deploy)
 *   tiles.openfreemap.org + /_next/static/*
 *       → stale-while-revalidate, trimmed FIFO/LRU-ish at MAX_SWR_ENTRIES
 *   navigations
 *       → network-first → cached copy of that page → cached "/" → /offline.html
 *   /api/* GETs
 *       → untouched (network-only); the app already renders honest
 *         empty/error states when these fail.
 */

const VERSION =
  new URL(self.location.href).searchParams.get("v") || "dev";

const PREFIX = "pubmax-sw-";
const DATA_CACHE = `${PREFIX}data-${VERSION}`;
const SWR_CACHE = `${PREFIX}swr-${VERSION}`;
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const CURRENT_CACHES = [DATA_CACHE, SWR_CACHE, SHELL_CACHE];

// Tiles + hashed build assets can grow without bound (a long crawl-planning
// session pulls hundreds of tiles). Cache.keys() returns entries oldest-first,
// so trimming from the front is a cheap LRU-ish FIFO cap.
const MAX_SWR_ENTRIES = 200;

const TILE_HOST = "tiles.openfreemap.org";
const OFFLINE_URL = "/offline.html";
// Pages worth having offline: the landing shell, the map shell, and /tonight
// (the installed-app start_url, issue #439). Precache is best-effort
// (allSettled) — a failed precache must never fail the install.
const SHELL_URLS = ["/", "/map", "/tonight", OFFLINE_URL];

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
    ),
  );
  // No skipWaiting(): the new worker waits for old tabs to close, so an
  // in-flight session is never handed a half-swapped asset graph.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(PREFIX) && !CURRENT_CACHES.includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

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
    return `${url.pathname}${url.search}`;
  } catch {
    return "/today";
  }
}

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

  // Static data JSON: cache-first for most assets, but price_updates must be
  // network-first so a sourced price refresh is not stuck behind a stale SW cache.
  if (sameOrigin && url.pathname.startsWith("/data/") && url.pathname.endsWith(".json")) {
    if (
      url.pathname.includes("/price_updates/") ||
      url.pathname.includes("/drink_price_updates/")
    ) {
      event.respondWith(networkFirstWithCache(event, request));
      return;
    }
    event.respondWith(cacheFirstWithRevalidate(event, request));
    return;
  }

  // Map tiles / glyphs / sprites + Next's hashed static assets:
  // stale-while-revalidate with a capped cache.
  if (url.hostname === TILE_HOST || (sameOrigin && url.pathname.startsWith("/_next/static/"))) {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }
  // Everything else: untouched.
});

function isCacheable(response) {
  return Boolean(response && response.ok && (response.type === "basic" || response.type === "cors"));
}

async function handleNavigation(event, request, url) {
  try {
    const response = await fetch(request);
    // Keep the shell copies fresh so the offline fallback is the latest deploy
    // this browser has seen — but only for the pages we deliberately shelve.
    if (response.ok && SHELL_URLS.includes(url.pathname)) {
      const copy = response.clone();
      event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) => cache.put(url.pathname, copy)),
      );
    }
    return response;
  } catch {
    const shell = await caches.open(SHELL_CACHE);
    const exact = await shell.match(url.pathname, { ignoreSearch: true });
    if (exact) return exact;
    const home = await shell.match("/", { ignoreSearch: true });
    if (home) return home;
    const offline = await shell.match(OFFLINE_URL, { ignoreSearch: true });
    if (offline) return offline;
    return new Response("You're offline and nothing is cached yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirstWithRevalidate(event, request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const revalidate = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        return cache.put(request, response.clone()).then(() => response);
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(revalidate);
    return cached;
  }
  const fresh = await revalidate;
  if (fresh) return fresh;
  return new Response("[]", {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

/** Prefer network for freshness-sensitive JSON; fall back to cache when offline. */
async function networkFirstWithCache(event, request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return new Response("[]", {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(SWR_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        return cache
          .put(request, response.clone())
          .then(() => trimCache(SWR_CACHE, MAX_SWR_ENTRIES))
          .then(() => response);
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return Response.error();
}

// FIFO trim: Cache.keys() yields insertion order, so deleting from the front
// drops the oldest-written entries first.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}
