import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyticsBuildEnv } from "./lib/analyticsAttribution.mjs";
import { resolveBuildStamp } from "./lib/buildInfo.mjs";
import { readWorkingTreeCommitSha, requireDataRevision } from "./lib/dataRevision.mjs";
import {
  freshnessArtifactIncludeById,
  freshnessArtifactIncludes,
} from "./lib/freshnessTracing.mjs";
import { PAL_MASCOT_SIZES, PAL_MASCOT_SLUGS } from "./lib/palMascotAssets.mjs";
import { staticAssetHeaderSources } from "./lib/staticAssetPrefixes.mjs";
import { runtimeDataPackRouteIncludes } from "./lib/venueIndexTracing.mjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const palMascotAssetPattern =
  "(?:" + Object.values(PAL_MASCOT_SLUGS).join("|") + ")-" +
  "(?:avatar-)?" +
  "(?:" + PAL_MASCOT_SIZES.join("|") + ")\\.(?:webp|png)";

const ukBaseManifest = JSON.parse(
  readFileSync(
    path.join(projectRoot, "public", "data", "uk_base", "manifest.json"),
    "utf8",
  ),
);
const ukBaseGeneration =
  /^\/data\/uk_base\/packs\/([a-f0-9]{16})\/$/.exec(ukBaseManifest.urlPrefix)?.[1] ?? "";

// The generation a browser may still hold a manifest for. Llandudno's pack was
// rebuilt under a new content-addressed generation and the old shard URLs went
// with it (#1015), so a stale manifest asked for files that no longer exist.
// The compatibility rewrite USED to live in proxy.ts, which meant every one of
// those requests - and every other /data request behind it - paid a Node
// function. It is a routing rule with no per-request input, so it belongs here:
// Vercel applies it at the edge and the CDN keeps serving the packs.
const LEGACY_UK_BASE_GENERATION = "e229e760f3e7a2fd";

// The freshness spine reads each dataset's artifact by a path taken from
// data/freshness_registry.json AT RUNTIME (join(process.cwd(), dataset.artifact)).
// Next's file tracing only follows paths it can see statically, so it traces NONE
// of them, and whether an artifact lands in a given function is then incidental —
// it depends on which other routes Vercel happens to co-bundle into that lambda.
// /api/freshness got lucky; /api/cron/freshness-audit, isolated into its own
// function by its `maxDuration`, shipped with no artifacts at all and reported
// every field-stamped feed as "unknown" every day. Declaring the list here is the
// fix, and it is derived from the registry rather than hand-copied so a new
// dataset cannot silently go untraced. The field-stamped ones are exactly the
// ones a reader opens (lib/freshnessTracing.mjs says why the others stay out).
// __tests__/freshnessTracing.test.ts pins it.
const freshnessRegistry = JSON.parse(
  readFileSync(path.join(projectRoot, "data", "freshness_registry.json"), "utf8"),
);
const freshnessArtifacts = freshnessArtifactIncludes(freshnessRegistry);

// Every App Router entry whose local import graph reaches a module that opens
// data from a path it assembles at REQUEST time reads files Next cannot see
// statically: the city venue packs, the venue detail manifest and rows, the id
// alias map, the menu overlay, the UK place index. Discover the reader routes
// from source and the file lists from the packs' own registries
// (RUNTIME_DATA_PACKS in lib/venueIndexTracing.mjs). This makes the next reader
// self-declaring instead of another route name somebody must remember to copy
// here. Dynamic segment brackets are escaped by the discovery helper because
// these keys are picomatch globs. __tests__/venueIndexTracing.test.ts pins
// discovery, config coverage, and that no undeclared runtime-path module exists.
const runtimeDataPackIncludes = runtimeDataPackRouteIncludes(projectRoot);

// A hand-written entry for a route that ALSO reads a discovered pack must merge
// with it, never replace it: last-write-wins here would silently drop the packs
// that route was found to open.
function withRuntimeDataPacks(route, files) {
  return [...new Set([...(runtimeDataPackIncludes[route] ?? []), ...files])];
}

// /feed also opens the sourced-price overlay at request time. That file is a
// separate dynamic path derived from the freshness registry; merge it with the
// packs discovered above. __tests__/feedTracing.test.ts pins both.
const feedDataFiles = withRuntimeDataPacks(
  "/feed",
  freshnessArtifactIncludeById(freshnessRegistry, "drink_price_updates"),
);

// Per-deploy build id for the offline service worker (issue #32). Next loads
// this config in more than one build process. A clock-derived value therefore
// gives one output several deployment ids, which makes the browser request the
// same client chunk once per id. Use one revision supplied by the release
// environment instead. Local builds use a stable marker because no worker from
// a local build can cross into production.
// The commit this build is building. Vercel only stamps VERCEL_GIT_COMMIT_SHA
// on a build its Git integration owns, and it stamps NEITHER the build nor the
// runtime of a `vercel deploy` from a CLI, so reading it at request time made
// /api/version answer null on exactly the deploys a verifier most needs to
// identify. Ask git for the working tree instead, ONCE, here: the source is
// uploaded with its .git directory on a CLI deploy, and a build with no
// repository around it still answers honestly (null) rather than guessing.
// lib/buildInfo.mjs owns the rule; app/api/version reads the values back.
const workingTreeCommitSha = readWorkingTreeCommitSha(projectRoot);

// The same tree also names the REVISION when no release environment does, which
// is what makes a production build possible from a clean worktree with a pulled
// environment (that file carries VERCEL_GIT_COMMIT_SHA="" and no deployment id).
// lib/dataRevision.mjs owns the order and the refusal; scripts/lib/slimShards.mjs
// stamps its shard payloads from the same rule, so a build and its data cannot
// disagree about which deploy they belong to.
const swVersion = requireDataRevision(process.env, {
  workingTreeSha: workingTreeCommitSha,
});

const buildStamp = resolveBuildStamp(process.env, { workingTreeSha: workingTreeCommitSha });

// Next 16 tags framework-owned assets and navigations with this identifier,
// allowing skew protection to keep stale clients on one deployment during a
// rollout. Vercel supplies its own deployment identifier on normal Git-based
// builds, so leave that platform-owned value untouched. A prebuilt or local
// build can provide DEPLOYMENT_VERSION; otherwise use the existing build-scoped
// service-worker marker.
const deploymentId = process.env.DEPLOYMENT_VERSION ??
  (process.env.VERCEL ? undefined : swVersion);

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
// dynamic rendering (no static generation / ISR / PPR) on every route except
// the two public documents named in proxy.ts's CDN_CACHED_DOCUMENT_PATHS, which
// take `script-src 'unsafe-inline'` in exchange for a CDN copy.

// Baseline security headers on every response.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // The app legitimately uses the camera (Pint Drop composer), geolocation
  // ("pubs near me" / nearest-venue), and microphone (Pub Pal voice) on its
  // own origin; everything else denied.
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(self), microphone=(self), payment=(), usb=()",
  },
  // Isolate our top-level browsing context (defence-in-depth against cross-origin
  // popup / XS-Leak attacks). Safe here: Google OAuth uses a redirect flow, not a
  // window.opener popup, so COOP doesn't break sign-in.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Every public asset has a fixed URL. Give it a modest browser window and a
// year at the edge, which Vercel purges on every deploy, so a changed asset
// cannot stay pinned in a browser no deploy can reach.
const UNHASHED_PUBLIC_ASSET_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800";

// Crawler and platform metadata always revalidate in browsers. The edge keeps
// a short window and may serve stale while it refreshes.
const SHORT_EDGE_PUBLIC_ASSET_CACHE_CONTROL =
  "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

// A worker script and the document it falls back to are the two files that may
// never outlive the deploy that shipped them: a stale service worker keeps
// serving a retired app shell from its own cache, which no CDN purge can
// reach. They revalidate on every request. (components/OfflineReady.tsx also
// registers /sw.js under a per-deploy ?v=, so this is the second line.)
const WORKER_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const HASHED_STATIC_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** One header rule: `source` takes `Cache-Control: value`. */
const cacheRule = (source, value) => ({
  source,
  headers: [{ key: "Cache-Control", value }],
});

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
  deploymentId,
  typescript: {
    tsconfigPath: "./tsconfig.build.json",
  },
  // Checks next/link hrefs and router.push/replace/prefetch against the App
  // Router. A string built at runtime is typed `Route` where it is built, never
  // at the link. `npm run typecheck` runs `next typegen` so tsc sees the types.
  typedRoutes: true,
  // Don't advertise the framework/version on dynamic responses.
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: {
    qualities: [75, 78],
    // Serve AVIF first (then WebP) for every next/image. Next negotiates by
    // Accept header; the source JPEGs stay the fallback. The landing
    // photographs of London do NOT come through here: they are pre-encoded at
    // both widths and both formats and served as a plain <picture>
    // (components/landing/LandingPhoto.tsx says why).
    formats: ["image/avif", "image/webp"],
  },
  outputFileTracingIncludes: {
    ...runtimeDataPackIncludes,
    // Both freshness readers need every registered artifact (see above).
    "/api/freshness": withRuntimeDataPacks("/api/freshness", freshnessArtifacts),
    "/api/cron/freshness-audit": withRuntimeDataPacks(
      "/api/cron/freshness-audit",
      freshnessArtifacts,
    ),
    // The dynamic feed opens its overlay + venue packs per request (see above).
    "/feed": feedDataFiles,
    // No "/sitemap.xml" key: that route is PRERENDERED at build, and Next skips
    // every include glob for a statically prerendered route (its packs are read
    // from the repository at build time, so there is nothing to ship).
  },
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    // Next's route-aware compiler API uses the TypeScript 6 `typescript` package.
    // npm run typecheck separately calls TypeScript 7's native CLI explicitly.
    useTypeScriptCli: false,
    // How long the CLIENT router may reuse a route it already holds.
    //
    // Dynamic routes would otherwise use Next's default zero reuse window.
    // Safety conditions and the /admin document-guard exception live in
    // docs/rules/app-proxy-csp-caching-and-file-tracing.md (Router Cache).
    //
    // The number is chosen against what these documents actually carry: a day
    // greeting, a quiet-pint window, a service-day boundary, bundled sourced
    // data. The sharpest thing on any of them is an HOUR boundary, and
    // everything that really moves (listings, prices, profiles, follow edges)
    // arrives through client API reads. Three minutes is therefore long
    // enough to cover a real excursion — leave Tonight, open the map, read a
    // pub, come back — and short enough that an hour-boundary document is never
    // wrong by much. A shorter window looks fine in a trace and expires exactly
    // when a drinker actually returns. `static` stays at Next's default.
    staleTimes: { dynamic: 180, static: 300 },
    // Lets app/admin/page.tsx call unauthorized() so an anonymous GET is a
    // real 401 with the token form, not a 200 console shell. Nothing else
    // calls unauthorized() or forbidden().
    authInterrupts: true,
  },
  env: {
    // See swVersion above — SW cache-busting build id.
    NEXT_PUBLIC_SW_VERSION: swVersion,
    // Inlined at build time and read back by app/api/version. Next replaces a
    // STATIC `process.env.NAME` member expression with the literal, so the
    // route must read these by name and never through a variable key.
    PUBMAX_BUILD_COMMIT_SHA: buildStamp.commitSha ?? "",
    PUBMAX_BUILD_COMMIT_SHA_SOURCE: buildStamp.commitShaSource ?? "",
    PUBMAX_BUILD_TIME: buildStamp.builtAt,
    // Which lane an analytics event came from. Decided HERE because VERCEL_ENV
    // reaches no browser bundle, so a build-time answer is the only one both
    // transports can read. lib/analyticsAttribution.mjs owns the rule.
    ...analyticsBuildEnv(process.env),
    // ConsentAwareVercelAnalytics and ConsentAwareVercelSpeedInsights read
    // process.env.VERCEL to skip Vercel scripts outside a Vercel deployment;
    // inlined at build like other env entries here.
    VERCEL: process.env.VERCEL ?? "",
  },
  skipTrailingSlashRedirect: true,
  async rewrites() {
    // beforeFiles, so the compatibility path is answered by the rule rather
    // than by whether a file happens to be absent. Both the source and the
    // destination sit under /data, so the `/data/:path*` cache-control rule in
    // headers() below still applies: headers match the address the reader
    // asked for.
    return {
      beforeFiles: ukBaseGeneration
        ? [
            {
              source: `/data/uk_base/packs/${LEGACY_UK_BASE_GENERATION}/:shard(\\d+\\.\\d+_-?\\d+\\.\\d+\\.json)`,
              destination: `/data/uk_base/packs/${ukBaseGeneration}/:shard`,
            },
          ]
        : [],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    // Social owns posts and public pub discovery. Retired route families go
    // straight to their canonical Social surface with no redirect chain.
    return [
      { source: "/map/uk", destination: "/map?uk=1", permanent: true },
      { source: "/map/uk/1", destination: "/map?uk=1", permanent: true },
      // The www -> apex host redirect lives in vercel.json, not here. `next
      // typegen` turns every source in this list into a typedRoutes route and
      // ignores `has`, so a host-conditioned "/:path*" became a root catch-all
      // that let a link to any missing page pass the typecheck.
      // __tests__/wwwHostRedirect.test.ts pins both halves.
      { source: "/feed", destination: "/social", permanent: true },
      { source: "/feed/:path*", destination: "/social", permanent: true },
      { source: "/stories", destination: "/social", permanent: true },
      { source: "/stories/:path*", destination: "/social", permanent: true },
      { source: "/discover", destination: "/social?tab=discover", permanent: true },
      { source: "/discover/:path*", destination: "/social?tab=discover", permanent: true },
      { source: "/drinks", destination: "/social?tab=discover", permanent: true },
      { source: "/drinks/:path*", destination: "/social?tab=discover", permanent: true },
      // The You surface lives at /u/you (the nav points there); the bare /you
      // path had no route and 404'd on shared links. A permanent (308) redirect
      // sends it to the canonical profile route. __tests__/storiesRedirect.test.ts
      // pins this alongside the /stories rules.
      { source: "/you", destination: "/u/you", permanent: true },
      // Landing still says "Our story"; keep the old paths as aliases.
      { source: "/our-story", destination: "/about", permanent: true },
      { source: "/story", destination: "/about", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Preview and development deploys must never be indexed, and the static
      // asset prefixes no longer pass through proxy.ts, which is where
      // applyNonProductionRobotsTag used to stamp them. Keep the header by a
      // static rule instead of a function: VERCEL_ENV is known at build, so a
      // production build emits no rule at all and app/robots.ts still stands
      // alone. lib/staticAssetPrefixes.mjs owns which prefixes those are.
      ...(process.env.VERCEL_ENV === "production"
        ? []
        : staticAssetHeaderSources().map((source) => ({
            source,
            headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
          }))),
      {
        // Easter egg, deliberately kept out of `securityHeaders` so that list
        // stays purely load-bearing. Nothing reads this header and nothing
        // should ever start: it is a nod to anyone poking about in the Network
        // tab, in the tradition of X-Clacks-Overhead. Safe to delete.
        source: "/:path*",
        headers: [{ key: "x-last-orders", value: "23:00" }],
      },
      {
        // Fixed-URL public assets take one browser hour, one edge year and
        // stale-while-revalidate. Crawler metadata uses a short edge window.
        // Workers and offline.html always revalidate. /og.png keeps the header
        // set by its route.
        //
        // The Apple universal-links manifest has no extension, so Next would
        // otherwise serve it as application/octet-stream. Apple's CDN requires
        // application/json. Content + TEAMID placeholder: docs/CAPACITOR_WRAP.md.
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: SHORT_EDGE_PUBLIC_ASSET_CACHE_CONTROL },
        ],
      },
      {
        // Android's App Links verifier reads this file to decide whether the
        // binary may open pubmaxxing.com links, and it re-reads it on install
        // and on update. The extension already earns application/json, so the
        // only thing owed here is the same SHORT edge window its Apple twin
        // takes: a fingerprint added on the weekend must reach the verifier in
        // minutes rather than sitting behind a year of edge cache.
        // Content + fingerprint placeholder: docs/CAPACITOR_WRAP.md.
        source: "/.well-known/assetlinks.json",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: SHORT_EDGE_PUBLIC_ASSET_CACHE_CONTROL },
        ],
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
          { key: "Cache-Control", value: UNHASHED_PUBLIC_ASSET_CACHE_CONTROL },
        ],
      },
      cacheRule("/_next/static/:path*", HASHED_STATIC_CACHE_CONTROL),
      cacheRule("/landing/:path*", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule("/vendor/:path*", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule("/store-assets/:path*", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule("/:icon(icon-.*\\.png)", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule("/:icon(icon-.*\\.svg)", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule("/:icon(apple-touch-icon.*\\.png)", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule("/:icon(favicon.*)", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule("/brand/:path*", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule(
        "/:boot(theme-init\\.js|map-first-paint-init\\.js)",
        UNHASHED_PUBLIC_ASSET_CACHE_CONTROL,
      ),
      cacheRule("/manifest.webmanifest", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule("/fonts/:path*", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule("/night-signals/:path*", UNHASHED_PUBLIC_ASSET_CACHE_CONTROL),
      cacheRule(
        "/pal/:asset(" + palMascotAssetPattern + ")",
        UNHASHED_PUBLIC_ASSET_CACHE_CONTROL,
      ),
      cacheRule("/llms.txt", SHORT_EDGE_PUBLIC_ASSET_CACHE_CONTROL),
      // Declared AFTER the asset rules on purpose: a later matching rule wins,
      // so a worker can never inherit the year-long edge window above.
      cacheRule("/:worker(sw\\.js|sw-plan-cache\\.js)", WORKER_CACHE_CONTROL),
      cacheRule("/offline.html", WORKER_CACHE_CONTROL),
    ];
  },
};

export default nextConfig;
