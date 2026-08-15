import "server-only";

import {
  buildDrinkBrandLanding,
  listDrinkBrandLandings,
  type DrinkBrandLanding,
} from "@/lib/drinkBrandLanding";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";

export type DrinkBrandLandingJsonLdNode = {
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

export async function loadDrinkBrandLandings(): Promise<DrinkBrandLanding[]> {
  return listDrinkBrandLandings(await loadPintPriceLandingVenues());
}

export async function loadDrinkBrandLanding(
  slug: string,
): Promise<DrinkBrandLanding | null> {
  return buildDrinkBrandLanding(slug, await loadPintPriceLandingVenues());
}

export function drinkBrandLandingJsonLd(
  landing: DrinkBrandLanding,
): DrinkBrandLandingJsonLdNode[] {
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
          name: landing.brandLabel,
          item: `${PRODUCTION_SITE_ORIGIN}/drink/${encodeURIComponent(landing.slug)}`,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Cheapest ${landing.brandLabel} pints in London`,
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
