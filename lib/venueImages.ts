const VENUE_IMAGE_BLOCKLIST = new Set(["images.app.goo.gl", "search.app.goo.gl"]);

export function directVenueImageUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (VENUE_IMAGE_BLOCKLIST.has(parsed.hostname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

/**
 * URL the CLIENT should render for a scraped/enrichment photo. Scraped photos
 * live on ~150 open-ended pub-website hosts the CSP img-src allowlist can't
 * cover, so they load through the same-origin /api/image-proxy (U4). Empty or
 * blocked inputs return "" exactly like directVenueImageUrl.
 */
export function proxiedVenueImageUrl(url: string): string {
  const direct = directVenueImageUrl(url);
  if (!direct) return "";
  return `/api/image-proxy?src=${encodeURIComponent(direct)}`;
}
