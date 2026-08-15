import "server-only";

import {
  buildDrinkBrandAreaLanding,
  listDrinkBrandAreaLandings,
  type DrinkBrandAreaLanding,
} from "@/lib/drinkBrandAreaLanding";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";

export type DrinkBrandAreaLandingJsonLdNode = {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList" | "ItemList";
  name?: string;
  numberOfItems?: number;
  itemListOrder?: string;
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item?: string;
    url?: string;
  }>;
};

export async function loadDrinkBrandAreaLandings(): Promise<DrinkBrandAreaLanding[]> {
  return listDrinkBrandAreaLandings(await loadPintPriceLandingVenues());
}

export async function loadDrinkBrandAreaLanding(
  areaSlug: string,
  brandSlug: string,
): Promise<DrinkBrandAreaLanding | null> {
  return buildDrinkBrandAreaLanding(
    areaSlug,
    brandSlug,
    await loadPintPriceLandingVenues(),
  );
}

export function drinkBrandAreaLandingJsonLd(
  landing: DrinkBrandAreaLanding,
): DrinkBrandAreaLandingJsonLdNode[] {
  const route = `/area/${encodeURIComponent(landing.areaSlug)}/drink/${encodeURIComponent(landing.brandSlug)}`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Map",
          item: `${PRODUCTION_SITE_ORIGIN}/map`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: landing.areaName,
          item: `${PRODUCTION_SITE_ORIGIN}/area/${encodeURIComponent(landing.areaSlug)}`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: landing.brandLabel,
          item: `${PRODUCTION_SITE_ORIGIN}${route}`,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Cheapest ${landing.brandLabel} pints in ${landing.areaName}`,
      numberOfItems: landing.rows.length,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: landing.rows.map((row) => ({
        "@type": "ListItem" as const,
        position: row.rank,
        name: row.venueName,
        url: `${PRODUCTION_SITE_ORIGIN}/ledger/${encodeURIComponent(row.venueId)}`,
      })),
    },
  ];
}
