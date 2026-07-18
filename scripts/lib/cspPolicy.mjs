// Single source of truth for the Content-Security-Policy, shared by BOTH tiers:
//
//   - proxy.ts (dynamic tier): per-request nonce script-src on the dynamic HTML
//     routes listed in DYNAMIC_CSP_PREFIXES.
//   - scripts/build_csp_route_headers.mjs (static tier): per-route sha256
//     script-src stamped into .next/routes-manifest.json after `next build`,
//     which is how statically generated pages get a strict CSP without a nonce
//     (a prebuilt shell can't know a request nonce; hashes of ITS OWN build
//     output need no request state at all).
//
// Plain .mjs (not TS) so the postbuild Node script can import it untranspiled;
// proxy.ts imports it via scripts/lib/cspPolicy.d.mts. Every non-script
// directive lives here EXACTLY ONCE — the per-directive rationale (img-src
// allowlist, style-src 'unsafe-inline' for MapLibre's runtime style injection,
// worker/child blob: for tile workers + the offline service worker, etc.)
// carries over from the original next.config.mjs block this grew from.

/** Every CSP directive EXCEPT script-src, in emission order. */
export const BASE_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://commons.wikimedia.org https://upload.wikimedia.org https://*.supabase.co https://*.googleusercontent.com https://gkbr-p-001.sitecorecontenthub.cloud https://www.jdwetherspoon.com https://live.staticflickr.com https://whatpub-new.s3.eu-west-1.amazonaws.com https://media-cdn.tripadvisor.com https://images.squarespace-cdn.com https://images.cdn.inapub.co.uk https://www.greeneking.co.uk https://encrypted-tbn0.gstatic.com https://static.wixstatic.com",
  "font-src 'self' data: https://tiles.openfreemap.org",
  "connect-src 'self' https://tiles.openfreemap.org https://basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  "child-src blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
];

/**
 * Assemble the full policy around a caller-built script-src. The script-src is
 * the ONLY directive that differs between the tiers; everything else must stay
 * byte-identical so the two tiers never drift apart.
 */
export function buildCsp(scriptSrc) {
  return [BASE_DIRECTIVES[0], scriptSrc, ...BASE_DIRECTIVES.slice(1)].join("; ");
}

/**
 * Dynamic HTML routes that keep the per-request nonce CSP (proxy.ts). Path
 * PREFIXES: a dynamic page route must start with one of these. proxy.ts's
 * `config.matcher` must stay the literal-matcher equivalent of this list —
 * Next.js requires statically analyzable matcher literals, so the lockstep is
 * enforced by __tests__/cspPolicy.test.ts rather than by importing this here.
 * scripts/build_csp_route_headers.mjs FAILS THE BUILD if a dynamic HTML page
 * route is covered by neither a prerendered header nor one of these prefixes —
 * a new dynamic route can never silently ship with no CSP at all.
 */
export const DYNAMIC_CSP_PREFIXES = [
  "/bar-tab/",
  "/crawls/",
  "/landmark/",
  "/ledger/",
  "/map",
  "/messages/",
  "/p/",
  "/plan/",
  "/recap/",
  "/rounds/",
  "/u/",
];
