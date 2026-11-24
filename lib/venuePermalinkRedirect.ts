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
 * Call only after a successful detail lookup. An unavailable alias read must
 * keep its recovery path rather than establish a permanent destination.
 */
export function redirectLegacyVenuePage(
  canonicalId: string,
  search: Record<string, string | string[] | undefined> = {},
): void {
  const section = search.__legacyVenueSection;
  if (section !== "ledger" && section !== "tab" && section !== "board") return;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (key === "__legacyVenueSection" || value === undefined) continue;
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
