const NO_STORE = "no-store";

export function jsonNoStore(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", NO_STORE);
  }
  return Response.json(body, { ...init, headers });
}

/**
 * Shared responses must satisfy the eligibility rules and named exceptions in
 * docs/PERFORMANCE_BUDGETS.md#which-api-reads-may-sit-at-the-edge.
 * Never cache a caller's identity, private content or location here.
 *
 * Vercel purges the edge on deploy. Mutable exceptions need explicit cache
 * windows because their data can change without a deploy. The browser
 * revalidates while the CDN may serve its shared copy. Query-string variants
 * cache independently because the CDN keys on the full URL.
 */
export function jsonCached(
  body: unknown,
  init: ResponseInit & { sMaxAge?: number; staleWhileRevalidate?: number } = {},
): Response {
  const { sMaxAge = 3600, staleWhileRevalidate = 86400, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (!headers.has("Cache-Control")) {
    headers.set(
      "Cache-Control",
      `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
    );
  }
  return Response.json(body, { ...rest, headers });
}
