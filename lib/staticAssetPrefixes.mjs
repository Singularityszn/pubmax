// THE PUBLIC DIRECTORIES THAT ARE PURE BYTES, AND WHY THE PROXY MUST NOT SEE THEM.
//
// proxy.ts is a Node function, and Vercel runs it IN FRONT OF the CDN for every
// path its matcher claims. The matcher claimed `/data`, so an 82 KB uk_base
// pack the edge already held still paid a function invocation on every request
// - and when one of those invocations failed, the reader got a 500 in front of
// a healthy static file (issue #1425, answered under the Wayfinder map #1423).
// The receipt is the CSP header: two consecutive `x-vercel-cache: HIT`
// responses for the same file carried DIFFERENT nonces, and a CDN copy cannot
// mint a nonce.
//
// Nothing the proxy does means anything on these bytes. A nonce in a JSON
// body's response header is inert; the host canonicalisation exists to collapse
// a crawlable DOCUMENT mirror and a data file is not one; and the cache-control
// these files need already ships from `headers()` in next.config.mjs, which is
// applied by the routing layer with no function in the path.
//
// THE RULE FOR ADDING ONE: the prefix must name a directory under `public/`
// that NO app route shares. `/pal` is the standing counter-example - it is BOTH
// `public/pal/` (mascot art) and `app/pal/` (a rendered page), so excluding it
// would strip the per-request nonce off a real document, which is the one thing
// the CSP contract in docs/PERFORMANCE_BUDGETS.md may not lose.
// `__tests__/staticAssetPrefixes.test.ts` refuses a prefix that collides with
// an app route, and holds proxy.ts's literal matcher to this list.
//
// This is plain ESM with a `.d.mts` sidecar (the `lib/brandMark.mjs` pattern)
// because next.config.mjs cannot import TypeScript and must read the same list.
export const STATIC_ASSET_PREFIXES = Object.freeze([
  "data",
  "brand",
  "fonts",
  "landing",
  "night-signals",
  "store-assets",
  "vendor",
]);

/**
 * The prefixes whose bytes the BUILD writes rather than the repository holding
 * them. Such a directory is a real served directory on every deployment, and
 * `npm run build` runs it on Vercel before `next build` reads `public/`, but it does
 * NOT exist in a fresh checkout that has only run `npm ci`. That is exactly the
 * shape of the CI unit-test job, so a fence that asked the file system whether
 * `public/vendor/` was there answered no and turned main red.
 *
 * A build-written prefix therefore proves itself by its GENERATOR instead of by
 * its bytes: the script named here must write into `public/<prefix>/` and must
 * be wired into `npm run build` ahead of `next build`, which is the step the deployed app depends on.
 * `__tests__/staticAssetPrefixes.test.ts` holds both halves, and holds every
 * other prefix to having bytes committed at HEAD, so a directory that exists
 * only on one developer's machine can never join this list unannounced.
 *
 * The naming follows `BUILD_WRITTEN_FIXED_URLS` in
 * `__tests__/publicAssetCaching.test.ts`, which records the same fact about the
 * same directory for the cache-control contract.
 */
export const BUILD_WRITTEN_STATIC_ASSET_PREFIXES = Object.freeze({
  vendor: Object.freeze({
    npmScript: "prepare:maplibre-worker",
    script: "scripts/copy_maplibre_worker.mjs",
    reason:
      "npm run build copies the MapLibre worker modules and the ElevenLabs AudioWorklet processors out of node_modules, so they are served from our own origin rather than a CDN or a blob URL the CSP would have to admit",
  }),
});

/** Whether a prefix's bytes arrive from the build rather than from the repo. */
export function isBuildWrittenStaticAssetPrefix(prefix) {
  return Object.hasOwn(BUILD_WRITTEN_STATIC_ASSET_PREFIXES, prefix);
}

/**
 * The alternation proxy.ts's matcher excludes, each prefix carrying its own
 * trailing slash so `/data/x.json` is excluded while a hypothetical `/database`
 * route would not be.
 *
 * Next.js only reads a middleware matcher it can analyse STATICALLY, so
 * proxy.ts writes the finished string out as a literal and the fence test
 * compares it with this. That also keeps the house rule the CSP exception list
 * already follows: widening what bypasses the proxy is a diff a reviewer sees.
 */
export function staticAssetMatcherAlternatives() {
  return STATIC_ASSET_PREFIXES.map((prefix) => `${prefix}/`).join("|");
}

// THE PUBLIC FILES AT THE ROOT, AND WHY THEY ARE NAMED BY EXTENSION.
//
// The prefixes above cover the public DIRECTORIES. The files that sit at the
// root of `public/` (theme-init.js, map-first-paint-init.js, sw.js, the
// manifest, every favicon and icon), and the mascot art under `public/pal/`,
// still ran the proxy: live headers on pubmaxxing.com showed a fresh CSP nonce
// on `/theme-init.js?v=splash-1`, a file the CDN already held, and a Node cold
// start sat in front of the two scripts the document loads in `<head>` before
// first paint. `/pal` cannot join the prefixes (see above), so those files are
// excluded by the extension at the END of the path instead.
//
// THE RULE FOR ADDING ONE: an extension names BYTES, never a document. `.html`
// is left out on purpose (public/offline.html is a document the service worker
// serves, and a document keeps its nonce), and so is `.xml`/`.csv`, whose
// paths are app routes. No page route may end in a listed extension:
// `__tests__/staticAssetPrefixes.test.ts` holds every committed root public file
// to the list and every app route folder to falling outside it.
export const STATIC_ASSET_EXTENSIONS = Object.freeze([
  "js",
  "json",
  "geojson",
  "webmanifest",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "avif",
  "svg",
  "ico",
  "ttf",
  "woff",
  "woff2",
  "txt",
]);

// THE EXTENSION RULE HOLDS ONLY WHERE THE FILES LIVE: the root of `public/`
// and `public/pal/`. An extension anywhere else proves nothing, because a
// dynamic page reads its segment however it likes: `/u/foo.png` normalises to
// the handle `foopng` and renders a real profile, which must keep its nonce.
// Neither the root nor `/pal/` has a dynamic page segment, and the fence test
// holds that.
export const STATIC_ASSET_FILE_DIRECTORIES = Object.freeze(["", "pal"]);

/**
 * The lookahead branch proxy.ts's matcher excludes for those extensions: one
 * segment at the root or under `/pal/`, ending in a listed extension. So `/pal`
 * still runs the proxy while `/pal/pal-wave.webp` does not, and `[^/?]*` keeps
 * the match inside one path segment.
 */
export function staticAssetExtensionMatcherAlternative() {
  return `(?:pal/)?[^/?]*\\.(?:${STATIC_ASSET_EXTENSIONS.join("|")})$`;
}

/** Whether a pathname is a root or `/pal/` file with a static extension. */
export function isStaticAssetFile(pathname) {
  const slash = pathname.lastIndexOf("/");
  if (!STATIC_ASSET_FILE_DIRECTORIES.includes(pathname.slice(1, Math.max(slash, 1)))) {
    return false;
  }
  const dot = pathname.lastIndexOf(".");
  if (dot === -1 || dot < slash) return false;
  return STATIC_ASSET_EXTENSIONS.includes(pathname.slice(dot + 1));
}

/** Header-rule sources for the same prefixes, for next.config.mjs `headers()`. */
export function staticAssetHeaderSources() {
  return STATIC_ASSET_PREFIXES.map((prefix) => `/${prefix}/:path*`);
}

/**
 * Whether a pathname is one of those static assets. proxy.ts keeps this as a
 * second line: the `*.vercel.app` matcher above the general rule still claims
 * every path on a preview artifact host, and a preview build has no more use
 * for a nonce on a font file than production does.
 */
export function isStaticAssetPath(pathname) {
  return (
    STATIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(`/${prefix}/`)) ||
    isStaticAssetFile(pathname)
  );
}
