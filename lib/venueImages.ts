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
