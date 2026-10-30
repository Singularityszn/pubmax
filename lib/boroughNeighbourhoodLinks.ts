// Internal links from a borough page to the Soho and Shoreditch content that
// already exists (SEO audit #2126, finding 17). Standalone /area/{slug} pages
// stay HELD, so nothing new is published: a borough links the map, framed on
// a night area, and the named route pages whose stops it holds.
//
// An area can span boroughs (Shoreditch's priced pubs sit in four), so a
// borough links an area when it holds at least NIGHT_AREA_LINK_FLOOR of the
// area's priced pubs. The count is read from the dataset rather than written
// down, so the links follow the data.

import type { Route } from "next";

import { slugifyBorough } from "@/lib/boroughs";
import { curatedCrawlById } from "@/lib/curatedCrawls";
import { NAMED_ROUTES, namedRoutePath } from "@/lib/namedRoutes";
import { getNightAreasForCity } from "@/lib/nightAreas";
import { assignVenueToNightArea } from "@/lib/pricedLanding";
import type { Venue } from "@/lib/venues";

/** The night areas this pass links. Both have content and neither has a page. */
export const LINKED_NIGHT_AREA_SLUGS = ["piccadilly-soho", "shoreditch"] as const;

export type BoroughLink = { href: Route; label: string };

function areaMapHref(areaName: string): Route {
  const params = new URLSearchParams();
  params.set("q", areaName);
  return `/map?${params.toString()}` as Route;
}

/** A borough links an area when it holds at least this many of its priced pubs. */
export const NIGHT_AREA_LINK_FLOOR = 5;

/** Slugs of the boroughs holding at least NIGHT_AREA_LINK_FLOOR of the area's priced pubs. */
export function nightAreaBoroughSlugs(areaSlug: string, venues: readonly Venue[]): string[] {
  const counts = new Map<string, number>();
  for (const venue of venues) {
    if (venue.cheapestPrice === null) continue;
    if (assignVenueToNightArea(venue)?.slug !== areaSlug) continue;
    const borough = slugifyBorough(venue.primaryBorough);
    if (!borough) continue;
    counts.set(borough, (counts.get(borough) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= NIGHT_AREA_LINK_FLOOR)
    .map(([borough]) => borough)
    .sort();
}

/** Map links for the linked night areas whose home borough is this one. */
export function boroughNightAreaLinks(boroughSlug: string, venues: readonly Venue[]): BoroughLink[] {
  const target = slugifyBorough(boroughSlug);
  return getNightAreasForCity("london")
    .filter((area) => (LINKED_NIGHT_AREA_SLUGS as readonly string[]).includes(area.slug))
    .filter((area) => nightAreaBoroughSlugs(area.slug, venues).includes(target))
    .map((area) => ({ href: areaMapHref(area.name), label: `${area.name} on the map` }));
}

/** The named route pages with at least one stop in this borough. */
export function boroughNamedRouteLinks(boroughSlug: string, venues: readonly Venue[]): BoroughLink[] {
  const target = slugifyBorough(boroughSlug);
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  return NAMED_ROUTES.flatMap((route) => {
    const crawl = curatedCrawlById(route.crawlId);
    if (!crawl) return [];
    const touches = crawl.venueIds.some((id) => {
      const venue = byId.get(id);
      return venue ? slugifyBorough(venue.primaryBorough) === target : false;
    });
    return touches ? [{ href: namedRoutePath(route.slug), label: `${crawl.name} route` }] : [];
  });
}
