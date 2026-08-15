import type { DrinkLandingModel } from "@/lib/drinkLanding";
import PriceLandingContent from "@/components/prices/PriceLandingContent";

const SITE_URL = "https://pubmaxxing.com";

export function drinkLandingJsonLd(
  model: DrinkLandingModel,
): Array<Record<string, unknown>> {
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Discover",
          item: `${SITE_URL}/discover`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: model.categoryLabel,
          item: `${SITE_URL}/drink/${model.category}`,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Cheapest beer in London",
      numberOfItems: model.rows.length,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: model.rows.map((row, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: row.name,
        url: `${SITE_URL}/ledger/${row.venueId}`,
      })),
    },
  ];
}

export default function DrinkLandingContent({
  model,
}: {
  model: DrinkLandingModel;
}) {
  return (
    <PriceLandingContent
      eyebrow="Beer prices"
      title="Cheapest beer in London"
      summary={`${model.totalPricedVenues} priced pubs, ranked by their cheapest pint on record. ${model.collectedLabel}`}
      mapHref="/map?drink=beer"
      mapLabel="See all beer prices on the map"
      rankedHeading="20 cheapest on record"
      rows={model.rows}
    />
  );
}
