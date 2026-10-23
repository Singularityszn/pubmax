import { lastOf } from "@/lib/tuple";

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

/**
 * The widths the proxy will resize to, and the ONLY ones it answers.
 *
 * A closed set rather than any number a caller asks for. The URL is the cache
 * key, so an open range is a cache-buster and a CPU amplification vector on a
 * route that already fetches a remote image per request.
 *
 * These four are next/image's OWN candidate widths (384 from its image sizes,
 * the rest from its device sizes), so a `srcset` descriptor and the width the
 * proxy really answers name the same number. A set of our own invention made
 * the desktop card ask for 384 and be handed 688: not wrong, but a picture
 * twice the size of the box, and nothing on either side said so.
 */
export const VENUE_IMAGE_WIDTHS = [384, 640, 1080, 1920] as const;
export type VenueImageWidth = (typeof VENUE_IMAGE_WIDTHS)[number];

export function isVenueImageWidth(value: number): value is VenueImageWidth {
  return (VENUE_IMAGE_WIDTHS as readonly number[]).includes(value);
}

/** The proxy URL for one width. */
export function proxiedVenueImageUrlAtWidth(url: string, width: VenueImageWidth): string {
  const base = proxiedVenueImageUrl(url);
  return base ? `${base}&w=${width}` : "";
}

/**
 * The closed width this proxy URL should be asked for to fill a box `asked`
 * pixels wide, or null when the URL is not ours to resize.
 *
 * /pubs shipped five photographs at their natural 1632x636 and 680x453 into a
 * 344x168 box, 934 KB of it measured on a phone, and its load was the slowest
 * on the site at 8289 ms on Slow 4G (Astra's live walk, 7 Sep 2026, finding
 * B8). The bytes were never about the page: nothing had ever asked the source
 * for a smaller picture.
 *
 * The answer is the narrowest width that covers the ask, and the widest we
 * offer when nothing covers it. `maxWidth` is how a surface caps the pixel
 * ratio it is willing to pay for: capping a decorative card at 688 is what
 * stops a 3x phone asking for three times the pixels of a washed background.
 */
export function venueImageWidthFor(
  proxyUrl: string,
  asked: number,
  maxWidth?: VenueImageWidth,
): VenueImageWidth | null {
  if (!proxiedImageSource(proxyUrl)) return null;
  const ceiling = maxWidth ?? lastOf(VENUE_IMAGE_WIDTHS);
  const offered = VENUE_IMAGE_WIDTHS.filter((width) => width <= ceiling);
  return offered.find((width) => width >= asked) ?? offered.at(-1) ?? null;
}

/**
 * The `loader` next/image spends to build its srcset over our own widths.
 *
 * A loader rather than a hand-written `srcSet` prop, because next/image sets
 * srcSet from its own attributes after spreading the rest, so one passed in is
 * silently dropped: measured, the page shipped the natural bytes and the prop
 * never reached the markup.
 */
export function venueImageLoader(
  maxWidth?: VenueImageWidth,
): (args: { src: string; width: number }) => string {
  return ({ src, width }) => {
    const source = proxiedImageSource(src);
    const answer = venueImageWidthFor(src, width, maxWidth);
    return source && answer ? proxiedVenueImageUrlAtWidth(source, answer) : src;
  };
}

/** Whether this URL is one the proxy can resize. */
export function isProxiedVenueImageUrl(url: string): boolean {
  return proxiedImageSource(url) !== "";
}

/** The `src` a proxy URL was built from, or "" when it is not a proxy URL. */
function proxiedImageSource(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl, "https://venue-image.invalid");
    if (parsed.pathname !== "/api/image-proxy") return "";
    return directVenueImageUrl(parsed.searchParams.get("src") ?? "");
  } catch {
    return "";
  }
}

// E3′ — one shared source-pick + provenance vocabulary for every place a
// venue photo renders (venue sheet header, feed cards, gallery thumbnails,
// hover cards). "chain" = a scraped/enrichment photo pulled from the pub's
// own website (routed through /api/image-proxy, above). "community" = a
// Pint Drop photo a real visitor uploaded (already a same-origin signed
// Supabase Storage URL — never proxied, never re-hosted through a third
// party). Honesty invariant: a photo with unknown provenance is never shown,
// so this module is the ONLY place a raw URL is allowed to become a render
// URL — every call site goes through here rather than inventing its own
// resolution order.
export type VenueImageProvenance = "chain" | "community";

export type VenueImageSource = {
  url?: string | null;
  provenance: VenueImageProvenance;
};

export type ResolvedVenueImage = {
  url: string;
  provenance: VenueImageProvenance;
};

// A pre-proxied chain URL (see lib/scrapedPubs.server.ts) is only accepted
// when it really is /api/image-proxy with a valid, unblocked ?src — a
// malformed one must fall through to the next candidate, not become a
// guaranteed-broken <img> that suppresses the community fallback.
function validatedProxiedVenueImageUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://venue-image.invalid");
    const src = parsed.searchParams.get("src");
    return parsed.pathname === "/api/image-proxy" && src && directVenueImageUrl(src)
      ? url
      : "";
  } catch {
    return "";
  }
}

/**
 * Picks the first source (in priority order) with a usable URL and resolves
 * it to a render-ready URL for that provenance. Returns null when nothing in
 * `sources` resolves — callers must show the honest gradient/empty fallback,
 * never a photo of unknown origin.
 *
 * `excludeUrls` lets a renderer skip candidates whose resolved URL already
 * failed to load, so a dead chain proxy advances to the next known source
 * (e.g. the community fallback) instead of ending at "No photo yet". See
 * VenueImage's onError path.
 */
export function resolveVenueImage(
  sources: VenueImageSource[],
  excludeUrls?: ReadonlySet<string>,
): ResolvedVenueImage | null {
  for (const source of sources) {
    if (!source.url) continue;
    // Some server-side loaders (e.g. lib/scrapedPubs.server.ts) already ran
    // the chain photo through proxiedVenueImageUrl before handing it to a
    // client component — recognise that pre-resolved shape, validate it, and
    // pass it through rather than trying (and failing) to re-proxy it.
    const resolved =
      source.provenance === "chain"
        ? source.url.startsWith("/api/image-proxy?")
          ? validatedProxiedVenueImageUrl(source.url)
          : proxiedVenueImageUrl(source.url)
        : directVenueImageUrl(source.url);
    if (!resolved || excludeUrls?.has(resolved)) continue;
    return { url: resolved, provenance: source.provenance };
  }
  return null;
}

export const VENUE_IMAGE_PROVENANCE_LABEL: Record<VenueImageProvenance, string> = {
  chain: "Photo: pub website",
  community: "Photo: community",
};
