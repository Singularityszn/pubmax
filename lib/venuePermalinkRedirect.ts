import { notFound, permanentRedirect } from "next/navigation";
import { NextResponse } from "next/server";

import { resolveVenuePermalinkSlug, venueMapUrl } from "@/lib/venueIndex";

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
    notFound();
  }
  if (!slug) notFound();

  const venueId = await resolveVenuePermalinkSlug(slug);
  if (!venueId) notFound();

  const destination = new URL(venueMapUrl(venueId), request.url);
  return NextResponse.redirect(destination, 308);
}

/**
 * A merged duplicate id (public/data/venue_id_aliases.json) answers a 308 to
 * the surviving venue's page, so one pub has one URL. `requestedId` is the
 * route param and `canonicalId` the id the detail lookup resolved it to.
 */
export function redirectMergedVenueId(
  basePath: "/ledger" | "/bar-tab" | "/pubs",
  requestedId: string,
  canonicalId: string,
): void {
  if (requestedId === canonicalId) return;
  permanentRedirect(`${basePath}/${encodeURIComponent(canonicalId)}`);
}
