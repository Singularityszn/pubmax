import Link from "next/link";

import PricedLandingRows, {
  PricedLandingPublisher,
  formatPricedLandingCollectedDate,
} from "@/components/drinks/PricedLandingRows";
import type { DrinkBrandAreaLanding } from "@/lib/drinkBrandAreaLanding";
import { pricedLandingCountLabel, type PricedLandingRow } from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

// The map opens on a PUB, never on `?q=<area name>`: `q` is a free-text venue
// filter (lib/venues.ts matchesVenueQuery), so an area name matches whatever
// pubs happen to carry it and "Piccadilly & Soho" matches none. The cheapest
// row is the pub this page is about, so it is the arrival.
function mapHref(landing: DrinkBrandAreaLanding, row: PricedLandingRow): string {
  return `/map?sel=${encodeURIComponent(row.venueId)}&brand=${encodeURIComponent(landing.brandSlug)}`;
}

function contributionHref(
  landing: DrinkBrandAreaLanding,
  row: PricedLandingRow,
): string {
  return `${mapHref(landing, row)}&log=1`;
}

export default function DrinkBrandAreaLandingContent({
  landing,
}: {
  landing: DrinkBrandAreaLanding;
}) {
  const firstRow = landing.rows[0];

  return (
    <div className="drinkBrandDirectory">
      <header className="drinkBrandDirectory__head">
        <p className="drinkBrandDirectory__eyebrow">
          <Link href="/map">London map</Link> <span aria-hidden="true">·</span>{" "}
          <Link href={`/drink/${encodeURIComponent(landing.brandSlug)}`}>
            {landing.brandLabel}
          </Link>{" "}
          <span aria-hidden="true">·</span> {landing.areaName}
        </p>
        <h1>
          Cheapest {landing.brandLabel} pints in {landing.areaName}
        </h1>
        <p className="drinkBrandDirectory__from">
          <strong>From {formatPrice(firstRow.priceGbp)}</strong>
          <PricedLandingPublisher
            className="drinkBrandDirectory__fromPublisher"
            row={firstRow}
            variant="hero"
          />
        </p>
        <p className="drinkBrandDirectory__summary">
          {landing.totalPricedVenues} pubs with listed {landing.brandLabel} pints. Collected{" "}
          {formatPricedLandingCollectedDate(landing.collectedAt)}.
        </p>
        <div className="drinkBrandDirectory__actions">
          <Link
            className="drinkBrandDirectory__primary"
            href={mapHref(landing, firstRow)}
          >
            Open the cheapest {landing.areaName} pint on the map
          </Link>
        </div>
      </header>

      <section
        className="drinkBrandDirectory__prices"
        aria-labelledby="drink-brand-area-price-heading"
      >
        <div className="drinkBrandDirectory__sectionHead">
          <h2 id="drink-brand-area-price-heading">The pubs</h2>
          <span className="drinkBrandDirectory__sectionCount">
            {pricedLandingCountLabel(landing.totalPricedVenues, landing.rows.length)}
          </span>
        </div>
        <PricedLandingRows
          rows={landing.rows}
          rowAction={(row) => ({
            href: contributionHref(landing, row),
            label: "Log this price",
          })}
        />
      </section>
    </div>
  );
}
