// THE FIVE CDN DOCUMENTS ANSWER WITHOUT A FUNCTION (task vercel-f1-cdn-documents).
//
// `/`, `/map`, `/tonight`, `/today` and `/near` are prerendered and served
// from the CDN (proxy.ts, CDN_CACHED_DOCUMENT_PATHS). The proxy still ran on
// every request for them, Clerk included, and Vercel runs that Node function
// IN FRONT OF the cache, so a CDN hit paid an invocation and a cold start for
// a policy that never changes between deploys. On the canonical host the
// matcher now leaves them out, and next.config.mjs ships their policy from
// `headers()` (lib/contentSecurityPolicy.mjs builds it for both).
//
// WHAT THE PROXY STILL OWNS ON THEM is a query, and only a query:
//   - `/?src=` is the printed-poster QR landing, a 307 to nearby prices
//     (lib/posterLanding.ts);
//   - `/map` with a key that changes its document is rewritten to the
//     per-request twin (lib/mapDocumentTwin.ts, MAP_DOCUMENT_QUERY_KEYS).
// A request carrying one of those keys still runs the proxy, through its own
// matcher entry, and the static header rule is held OFF it by the same keys
// as `missing` conditions, so a request gets its policy from exactly one place.
// Every other branch of securityProxy keys on a path these five do not have,
// and the `*.vercel.app` matcher still claims every path, so preview and
// generated hosts behave exactly as before.
//
// WHY CLERK NEED NOT RUN: no server code in this app reads Clerk auth (nothing
// imports `@clerk/nextjs/server` outside proxy.ts), and these documents are
// rendered at build or ISR time, when no middleware runs anyway. Clerk mounts
// client-side after first paint (components/auth/OptionalClerkProvider.tsx)
// and refreshes its own session token, so skipping clerkMiddleware on these
// requests drops only its handshake redirect, not a session.
//
// `__tests__/cdnDocumentEdge.test.ts` holds the matcher literal in proxy.ts,
// the header rules here and the lists in lib/ to each other.

/** The documents that answer from the CDN with no function in front. */
export const CDN_EDGE_DOCUMENT_PATHS = Object.freeze([
  "/",
  "/map",
  "/tonight",
  "/today",
  "/near",
]);

/**
 * The query keys that still need the proxy, per path. `/` is the poster
 * landing's `src` (POSTER_LANDING_SRC's key); `/map` is MAP_DOCUMENT_QUERY_KEYS,
 * restated because next.config.mjs cannot import TypeScript. The fence test
 * holds both copies equal.
 */
export const CDN_EDGE_PROXY_QUERY_KEYS = Object.freeze({
  "/": Object.freeze(["src"]),
  "/map": Object.freeze(["place", "uk", "band", "crawl", "pubs", "card"]),
});

/**
 * The lookahead branch proxy.ts's general matcher excludes. The general rule
 * captures the path after its leading slash, so `$` alone is `/`.
 */
export function cdnEdgeMatcherAlternatives() {
  return CDN_EDGE_DOCUMENT_PATHS.map((path) => `${path.slice(1)}$`).join("|");
}

/**
 * The matcher entries that keep the proxy on a query it acts on. Each carries
 * the general rule's `missing` router-prefetch clause, so a request reaches
 * the proxy exactly when it reached it before this change.
 */
export function cdnEdgeProxyMatchers() {
  return Object.entries(CDN_EDGE_PROXY_QUERY_KEYS).flatMap(([source, keys]) =>
    keys.map((key) => ({
      source,
      has: [{ type: "query", key }],
      missing: [{ type: "header", key: "next-router-prefetch" }],
    })),
  );
}

/** The `headers()` rules that ship the policy where the proxy no longer runs. */
export function cdnEdgeHeaderRules(contentSecurityPolicy) {
  return CDN_EDGE_DOCUMENT_PATHS.map((source) => {
    const keys = CDN_EDGE_PROXY_QUERY_KEYS[source] ?? [];
    return {
      source,
      ...(keys.length > 0
        ? { missing: keys.map((key) => ({ type: "query", key })) }
        : {}),
      headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }],
    };
  });
}
