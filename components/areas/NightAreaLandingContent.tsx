import type { NightAreaLandingModel } from "@/lib/nightAreaLanding";
import PriceLandingContent from "@/components/prices/PriceLandingContent";

const SITE_URL = "https://pubmaxxing.com";

export function nightAreaLandingJsonLd(
  model: NightAreaLandingModel,
): Array<Record<string, unknown>> {
  const pageUrl = `${SITE_URL}/area/${model.slug}`;
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
          name: model.name,
          item: pageUrl,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Cheapest pints in ${model.name}`,
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

export default function NightAreaLandingContent({
  model,
}: {
  model: NightAreaLandingModel;
}) {
  const mapHref = `/map?q=${encodeURIComponent(model.name)}`;
  return (
    <PriceLandingContent
      eyebrow="Night Area prices"
      title={`Cheapest pints in ${model.name}`}
      summary={`${model.totalPricedVenues} publisher-backed pubs in this Night Area, ranked by their cheapest pint on record. ${model.collectedLabel}`}
      mapHref={mapHref}
      mapLabel={`See ${model.name} on the map`}
      rankedHeading="10 cheapest on record"
      rows={model.rows}
    />
  );
}
