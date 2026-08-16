import Link from "next/link";

import PricedLandingRows, {
  PricedLandingPublisher,
  formatPricedLandingCollectedDate,
} from "@/components/drinks/PricedLandingRows";
import type { DrinkBrandAreaLanding } from "@/lib/drinkBrandAreaLanding";
import {
  pricedLandingCountLabel,
  pricedLandingMapArrivalRow,
  pricedLandingMapHref,
  type MapSelectableVenueIds,
  type PricedLandingRow,
} from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

// The map opens on a PUB, never on `?q=<area name>`: `q` is a free-text venue
// filter (lib/venues.ts matchesVenueQuery), so an area name matches whatever
// pubs happen to carry it and "Piccadilly & Soho" matches none. A pub is named
// only while the map can resolve it, through the same seam the London brand
// page uses.
export default function DrinkBrandAreaLandingContent({
  landing,
  mapSelectableVenueIds,
}: {
  landing: DrinkBrandAreaLanding;
  mapSelectableVenueIds: MapSelectableVenueIds;
}) {
  const firstRow = landing.rows[0];
  // The heading names the CHEAPEST pint here, so the arrival is that row or no
  // row at all: a different pub would make the label untrue, and a `sel` the
  // map cannot open would make it unreachable.
  const selectableVenueId = (row: PricedLandingRow): string | undefined =>
    pricedLandingMapArrivalRow([row], mapSelectableVenueIds)?.venueId;

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
            href={pricedLandingMapHref({
              brandSlug: landing.brandSlug,
              venueId: selectableVenueId(firstRow),
            })}
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
            href: pricedLandingMapHref({
              brandSlug: landing.brandSlug,
              venueId: selectableVenueId(row),
              log: true,
            }),
            label: "Log this price",
          })}
        />
      </section>
    </div>
  );
}
