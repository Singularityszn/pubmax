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

// Content-Security-Policy is NO LONGER served from here. It moved to proxy.ts
// (Next.js 16's renamed `middleware` convention) so it can be built PER-REQUEST
// with a fresh nonce — that is the only way to drop `script-src 'unsafe-inline'`
// while still allowing Next's inline RSC bootstrap/hydration scripts (their
// sha256 differs per page and per build, so they can't be statically hashed).
// See proxy.ts for the full policy + the per-directive rationale (img-src
// allowlist, connect-src tiles/supabase/wss, style-src 'unsafe-inline' for
// MapLibre, worker/child blob:, etc.). All the OTHER security headers below
// (HSTS, nosniff, XFO, Permissions-Policy, COOP, Referrer) stay here on
// `/:path*`; only the CSP moved. Trade-off: the per-request nonce forces
// dynamic rendering for every route (no static generation / ISR / PPR).

// Baseline security headers on every response.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
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
  images: {
    qualities: [75, 78],
    // Serve AVIF first (then WebP) for every next/image — notably the landing
    // hero-night.jpg (fill+priority). Next negotiates by Accept header; the
    // source JPEGs stay the fallback.
    formats: ["image/avif", "image/webp"],
  },
  outputFileTracingIncludes: {
    // App Router dynamic segment — must match app/api/venue/[id]/route.ts.
    "/api/venue/[id]": [
      "./data/generated/venue_detail_index.json",
      "./data/generated/venue_details.jsonl",
    ],
  },
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
  async redirects() {
    // The Stories tab settled on /feed; the old /stories route (and any deep
    // link beneath it) is retired. A permanent (308) redirect keeps shared
    // links and search-engine equity alive instead of dropping visitors on an
    // unbranded 404. __tests__/storiesRedirect.test.ts pins this.
    return [
      // Host canonicalisation (SEO split-brain fix, docs/SEO_CANONICAL_RUNBOOK
      // _2026-07-21.md). www.pubmaxxing.com was serving a full 200 MIRROR of the
      // app instead of redirecting to the apex, so Google indexed it as a second
      // site and pinned a stale crawl (old title/favicon) under the www host.
      // Every page already emits an apex `rel=canonical` (metadataBase +
      // per-route alternates.canonical), but a canonical is only a HINT — a URL
      // that answers 200 with no redirect keeps getting indexed. This permanent
      // (308) host redirect is the DIRECTIVE that collapses www into the apex,
      // and it lives in-repo so the consolidation holds regardless of the Vercel
      // dashboard domain config (which should ALSO be set to redirect www→apex;
      // see the runbook). `has` host match fires only for the www host, so the
      // apex is never self-redirected. :path* preserves the full path + carries
      // "/" through to the apex root. __tests__/wwwHostRedirect.test.ts pins it.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.pubmaxxing.com" }],
        destination: "https://pubmaxxing.com/:path*",
        permanent: true,
      },
      { source: "/stories", destination: "/feed", permanent: true },
      { source: "/stories/:path*", destination: "/feed", permanent: true },
      // The You surface lives at /u/you (the nav points there); the bare /you
      // path had no route and 404'd on shared links. A permanent (308) redirect
      // sends it to the canonical profile route. __tests__/storiesRedirect.test.ts
      // pins this alongside the /stories rules.
      { source: "/you", destination: "/u/you", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Apple universal-links manifest (Capacitor iOS wrap). The file lives
        // in public/ with NO extension, so Next would otherwise serve it as
        // application/octet-stream — Apple's CDN requires application/json.
        // Content + TEAMID placeholder: docs/CAPACITOR_WRAP.md.
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
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
