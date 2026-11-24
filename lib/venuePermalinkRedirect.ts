import { permanentRedirect } from "next/navigation";
import { NextResponse } from "next/server";

import { resolveVenuePermalinkSlug, venueMapUrl } from "@/lib/venueIndex";
import { LEGACY_VENUE_ROUTES, LEGACY_VENUE_SECTION_PARAM } from "./legacyVenueRoutes.mjs";

function missingVenueResponse(): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Pub not found | PUBMAXX</title><style>html{color-scheme:light dark}body{font-family:system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:0 1.5rem;line-height:1.5}a{display:inline-block;margin:1rem 1rem 0 0;color:inherit}</style></head><body><main><p>PUBMAXX</p><h1>Pub not found</h1><p>We could not find this pub. Search for another pub or open the map.</p><a href="/pubs">Search pubs</a><a href="/map">Open the map</a></main></body></html>`, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

type RouteContext = {
  params: Promise<{ slug: string }>;
};

/**
 * Shared GET for `/venue/:slug` and `/pub/:slug`: map deep-link when the slug
 * resolves, branded 404 otherwise. No HTML page of its own.
 */
export async function venuePermalinkRedirect(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { slug: raw } = await context.params;
  let slug: string;
  try {
    slug = decodeURIComponent(raw ?? "").trim();
  } catch {
    return missingVenueResponse();
  }
  if (!slug) return missingVenueResponse();

  const venueId = await resolveVenuePermalinkSlug(slug);
  if (!venueId) return missingVenueResponse();

  const destination = new URL(venueMapUrl(venueId), request.url);
  return NextResponse.redirect(destination, 308);
}

/**
 * Call only after a successful detail lookup. An unavailable alias read must
 * keep its recovery path rather than establish a permanent destination.
 */
export function redirectLegacyVenuePage(
  canonicalId: string,
  search: Record<string, string | string[] | undefined> = {},
): void {
  const section = search[LEGACY_VENUE_SECTION_PARAM];
  if (typeof section !== "string" || !Object.values(LEGACY_VENUE_ROUTES).includes(section)) return;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (key === LEGACY_VENUE_SECTION_PARAM || value === undefined) continue;
    for (const item of typeof value === "string" ? [value] : value) query.append(key, item);
  }
  const suffix = query.size ? `?${query}` : "";
  permanentRedirect(`/pubs/${encodeURIComponent(canonicalId)}${suffix}#${section}`);
}

export function redirectMergedVenueId(
  basePath: "/ledger" | "/bar-tab" | "/pubs",
  requestedId: string,
  canonicalId: string,
): void {
  if (requestedId === canonicalId) return;
  permanentRedirect(`${basePath}/${encodeURIComponent(canonicalId)}`);
}
