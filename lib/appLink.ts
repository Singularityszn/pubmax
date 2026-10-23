import type { Route } from "next";

/**
 * A link that either stays in the app (a typed Route for next/link) or leaves
 * it (a source URL for a plain anchor). The `external` flag is the
 * discriminant, so a renderer that branches on it gets the right href type.
 */
export type AppOrExternalLink =
  | { href: Route; external: false }
  | { href: string; external: true };

/**
 * The current page with a rebuilt query string. `pathname` comes from
 * usePathname(), so it already names a route this app serves.
 */
export function samePathWithQuery(pathname: string, query: string): Route {
  return (query ? `${pathname}?${query}` : pathname) as Route;
}

/** A drinker's profile page. */
export function profilePath(handle: string): Route {
  return `/u/${encodeURIComponent(handle)}` as Route;
}

/** A pub's bar tab page. */
export function barTabPath(venueId: string): Route {
  return `/bar-tab/${encodeURIComponent(venueId)}` as Route;
}
