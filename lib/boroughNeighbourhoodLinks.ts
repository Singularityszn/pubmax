// Internal links from a borough page to the area and route pages that cover
// it (SEO audit #2126, finding 17). A borough links every published area page
// (lib/areaLanding.ts) and every named route page whose stops it holds.
//
// An area can span boroughs (Shoreditch's priced pubs sit in four), so a
// borough links an area when it holds at least NIGHT_AREA_LINK_FLOOR of the
// area's priced pubs. The count is read from the dataset rather than written
// down, so the links follow the data.

import type { Route } from "next";

import { slugifyBorough } from "@/lib/boroughs";
import { curatedCrawlById } from "@/lib/curatedCrawls";
import { NAMED_ROUTES, namedRoutePath } from "@/lib/namedRoutes";
import { areaLandingRoute, listAreaLandings } from "@/lib/areaLanding";
import { assignVenueToNightArea } from "@/lib/pricedLanding";
import type { Venue } from "@/lib/venues";

export type BoroughLink = { href: Route; label: string };

/** A borough links an area when it holds at least this many of its priced pubs. */
const NIGHT_AREA_LINK_FLOOR = 5;

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

/** Links to the published area pages that cover this borough. */
export function boroughNightAreaLinks(boroughSlug: string, venues: readonly Venue[]): BoroughLink[] {
  const target = slugifyBorough(boroughSlug);
  return listAreaLandings(venues)
    .filter((landing) => nightAreaBoroughSlugs(landing.areaSlug, venues).includes(target))
    .map((landing) => ({
      href: areaLandingRoute(landing.areaSlug) as Route,
      label: `Cheapest pints in ${landing.areaName}`,
    }));
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
