import "server-only";

import { areaLandingRoute, buildAreaLanding, listAreaLandings, type AreaLanding } from "@/lib/areaLanding";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { pricedLandingJsonLd, type PricedLandingJsonLdNode } from "@/lib/pricedLanding";

export async function loadAreaLanding(slug: string): Promise<AreaLanding | null> {
  return buildAreaLanding(slug, await loadPintPriceLandingVenues());
}

export async function loadAreaLandings(): Promise<AreaLanding[]> {
  return listAreaLandings(await loadPintPriceLandingVenues());
}

export function areaLandingJsonLd(landing: AreaLanding): PricedLandingJsonLdNode[] {
  return pricedLandingJsonLd({
    breadcrumb: [
      { name: "Map", path: "/map" },
      { name: landing.areaName, path: areaLandingRoute(landing.areaSlug) },
    ],
    listName: `Cheapest pints in ${landing.areaName}`,
    rows: landing.rows,
  });
}
