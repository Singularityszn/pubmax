import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Per-deploy build id for the offline service worker (issue #32). Evaluated
// once when `next build` loads this config and inlined into the client bundle
// as NEXT_PUBLIC_SW_VERSION; components/OfflineReady.tsx appends it to the
// registration URL (/sw.js?v=…). A new deploy → new URL → the browser installs
// a fresh worker whose `activate` deletes the previous version's caches. The
// env override lets CI/Vercel pin it to a commit SHA if ever desired; the
// timestamp default needs zero extra scripts or package.json changes.
const swVersion = process.env.NEXT_PUBLIC_SW_VERSION ?? Date.now().toString(36);

// Content-Security-Policy. Every directive below maps to a real app dependency
// so everything else is locked down to 'self':
//   - script-src: NO production 'unsafe-eval', NO wildcard/CDN script origins.
//     Local `next dev` gets a dev-only 'unsafe-eval' allowance because React
//     development tooling uses eval for call-stack reconstruction; production
//     builds never receive it.
//     Our own
//     no-flash theme script is an EXTERNAL file (public/theme-init.js), so it is
//     covered by 'self' with no per-build hash — see app/layout.tsx.
//     'unsafe-inline' here is required ONLY by Next.js 16's own App-Router RSC
//     streaming scripts (the per-page `self.__next_f.push(...)` bootstrap +
//     hydration payload). Those are inline, and their content — hence their
//     sha256 — differs per page AND per build, so they can't be statically
//     hashed; `'strict-dynamic'` doesn't cover them (it also breaks the async
//     external chunks) and `experimental.sri` only adds integrity to external
//     <script src>, leaving the inline payload unhashed. The ONLY way to drop
//     'unsafe-inline' without breaking hydration is a per-request nonce applied
//     via middleware — which forces dynamic rendering (killing this app's static
//     generation) and lives outside next.config.mjs. When a nonce/middleware
//     layer is added, replace 'unsafe-inline' with 'nonce-<value>' here.
//     NB: browsers ignore 'unsafe-inline' whenever a nonce or hash is also
//     present, so this is not a lever for silencing hash mismatches.
//   - style-src: 'unsafe-inline' is required — MapLibre GL injects inline styles
//     at runtime (canvas controls, marker positioning).
//   - img-src: data:/blob: (canvas + og), Wikimedia (landmark photos), Supabase
//     (Pint Drop pint photos in Storage).
//   - font-src / connect-src: openfreemap tiles+glyphs+sprites, Supabase
//     auth/rest/storage. TfL is server-only (/api/last-train) so it's NOT listed.
//     connect-src ALSO lists the CARTO basemap hosts: when OpenFreeMap is slow or
//     down, PubMapCanvas swaps to CARTO's keyless styles (FALLBACK_STYLES). CARTO
//     serves the style.json entrypoint from basemaps.cartocdn.com and everything
//     the style references — sprite, glyphs, TileJSON + vector tiles — from
//     tiles.basemaps.cartocdn.com. MapLibre fetches ALL of these via fetch(), so
//     both hosts must be in connect-src or the fallback is CSP-blocked and users
//     hit the "Map tiles unavailable" screen on any transient OpenFreeMap blip.
//     connect-src ALSO explicitly lists `wss://*.supabase.co`: the `https://` entry
//     covers the REST/auth/storage fetch() calls, but Supabase Realtime
//     (lib/realtime.ts) opens a WEBSOCKET to wss://<project-ref>.supabase.co/realtime/...,
//     and browsers treat `wss:` as a distinct scheme from `https:` for CSP
//     connect-src matching — an `https://*.supabase.co` entry does NOT authorize
//     a `wss://` connection. Without this, the socket is silently blocked and
//     lib/realtime.ts falls back to polling. Scoped to the Supabase wildcard only
//     (no blanket `wss:`).
//   - worker-src/child-src blob:: MapLibre spins up its tile workers from blobs.
//     worker-src 'self' ALSO covers the offline service worker (public/sw.js,
//     issue #32); its fetch/caching targets (self + tiles.openfreemap.org) are
//     already in connect-src, so no CSP loosening was needed for offline mode.
const scriptSrc =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

const contentSecurityPolicy = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://commons.wikimedia.org https://upload.wikimedia.org https://*.supabase.co",
  "font-src 'self' data: https://tiles.openfreemap.org",
  "connect-src 'self' https://tiles.openfreemap.org https://basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  "child-src blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// Baseline security headers on every response.
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // The app legitimately uses the camera (Pint Drop composer) and geolocation
  // ("pubs near me" / nearest-venue) on its own origin; everything else denied.
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()",
  },
  // Isolate our top-level browsing context (defence-in-depth against cross-origin
  // popup / XS-Leak attacks). Safe here: Google OAuth uses a redirect flow, not a
  // window.opener popup, so COOP doesn't break sign-in.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// CORS policy (deliberate): we set NO `Access-Control-Allow-Origin` header. Vercel's
// CDN attaches `Access-Control-Allow-Origin: *` to PUBLIC static/prerendered assets
// only (HTML, /_next/static/*, /data/*.json) — that is safe: the content is already
// world-readable and there is NO `Access-Control-Allow-Credentials` anywhere, so a
// cross-origin credentialed read is impossible (and `* + credentials` is spec-illegal).
// Our dynamic /api/* routes return no CORS headers, so cross-origin browser reads/writes
// of app data are blocked. RULE: never add `Access-Control-Allow-Origin` or
// `Access-Control-Allow-Credentials` to an /api/* route; if one ever truly needs CORS,
// scope it per-route to trusted origins only (+ `Vary: Origin`).
// __tests__/corsPolicy.test.ts enforces this.

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework/version on dynamic responses.
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    // IDEAS B4 — View Transitions between map ↔ feed ↔ venue. In Next 16 this
    // flag makes App Router route navigations activate the browser's
    // View Transitions API automatically (each Link navigation is wrapped in
    // startViewTransition), so a root-level `::view-transition-old/new`
    // crossfade in globals.css animates page swaps with ZERO per-element
    // shared-element choreography (no <ViewTransition> wrappers, no
    // viewTransitionName). Pure progressive enhancement: browsers without the
    // View Transitions API ignore the pseudo-elements and React falls back to
    // today's instant swap; prefers-reduced-motion users get no animation via
    // the media guard on those rules. See app/globals.css "View Transitions".
    viewTransition: true,
  },
  env: {
    // See swVersion above — SW cache-busting build id.
    NEXT_PUBLIC_SW_VERSION: swVersion,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The pub-price dataset is ~6 MB and effectively static between deploys.
        // These files live in public/ so their URLs are fixed and UNHASHED, and
        // several fetch sites (PubMapCanvas tfl_lines, PubMap price_updates) live
        // in files this change can't touch — so we CANNOT append a ?v= cache
        // buster, which means `immutable` is unsafe (a returning browser could
        // pin stale prices across a deploy with no way to bust it).
        //
        // Instead we lean on the CDN, which Vercel purges automatically on every
        // deploy: s-maxage is pushed to a full year so the edge serves these from
        // cache (near-instant TTFB) between deploys, while the browser max-age
        // stays modest (1h) so a returning client still revalidates and picks up
        // fresh data without a hard block. stale-while-revalidate widens the
        // window in which a stale-but-instant response is served while a fresh
        // copy is fetched in the background. Net: big edge-cache TTFB win, zero
        // added staleness risk vs. the previous header.
        source: "/data/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
