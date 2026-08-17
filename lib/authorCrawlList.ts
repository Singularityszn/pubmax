// How many crawls one page of an author's public listing may hold.
//
// ONE owner for the two bounds, imported by the store that applies them, the
// route that parses `?limit=`, and the profile that pages through them. This
// module imports NOTHING so the browser can read the ceiling without pulling the
// server-only crawl-story store in behind it (the same rule lib/handleNormalize
// and lib/formatGbp follow).

export const AUTHOR_CRAWL_LIST_DEFAULT_LIMIT = 10;
export const AUTHOR_CRAWL_LIST_MAX_LIMIT = 25;

/**
 * The page size a caller asked for, clamped into the published range. Anything
 * unparseable is the default rather than an error: a listing is a read, and a
 * junk `?limit=` should show the ordinary first page.
 */
export function clampAuthorCrawlListLimit(
  value: string | number | null | undefined,
): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return AUTHOR_CRAWL_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), AUTHOR_CRAWL_LIST_MAX_LIMIT);
}
