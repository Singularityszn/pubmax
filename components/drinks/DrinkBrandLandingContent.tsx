import Link from "next/link";

import PricedLandingRows, {
  PricedLandingPublisher,
  formatPricedLandingCollectedDate,
} from "@/components/drinks/PricedLandingRows";
import type { DrinkBrandLanding } from "@/lib/drinkBrandLanding";
import { pricedLandingCountLabel } from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

// `?brand=` alone. Beer is the lane the map RESTS in, so `?drink=beer` would
// select a beer LENS and swap the pint bands for corroborated category prices;
// a matched brand already implies its category (docs/MAP_URL_PARAMS.md).
function mapHref(landing: DrinkBrandLanding): string {
  return `/map?brand=${encodeURIComponent(landing.slug)}`;
}

// `log=1` arms the composer for the RESOLVED venue, so it needs a `sel`. The
// cheapest row is the one the page opens with.
function contributionHref(landing: DrinkBrandLanding): string {
  const params = new URLSearchParams({
    sel: landing.rows[0].venueId,
    brand: landing.slug,
    log: "1",
  });
  return `/map?${params.toString()}`;
}

export default function DrinkBrandLandingContent({
  landing,
}: {
  landing: DrinkBrandLanding;
}) {
  const firstRow = landing.rows[0];
  const lowestPrice = formatPrice(firstRow.priceGbp);

  return (
    <div className="drinkBrandDirectory">
      <header className="drinkBrandDirectory__head">
        <p className="drinkBrandDirectory__eyebrow">
          <Link href="/map">London map</Link> <span aria-hidden="true">·</span>{" "}
          {landing.brandLabel}
        </p>
        <h1>Cheapest {landing.brandLabel} pints in London</h1>
        <p className="drinkBrandDirectory__from">
          <strong>From {lowestPrice}</strong>
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
        <nav
          className="drinkBrandDirectory__actions"
          aria-label={`${landing.brandLabel} pint actions`}
        >
          <Link className="drinkBrandDirectory__primary" href={mapHref(landing)}>
            Find {landing.brandLabel} on the map
          </Link>
          <Link
            className="drinkBrandDirectory__secondary"
            href={contributionHref(landing)}
          >
            Log a {landing.brandLabel} pint price
          </Link>
        </nav>
      </header>

      <section
        className="drinkBrandDirectory__prices"
        aria-labelledby="drink-brand-price-heading"
      >
        <div className="drinkBrandDirectory__sectionHead">
          <h2 id="drink-brand-price-heading">The pubs</h2>
          <span className="drinkBrandDirectory__sectionCount">
            {pricedLandingCountLabel(landing.totalPricedVenues, landing.rows.length)}
          </span>
        </div>
        <PricedLandingRows rows={landing.rows} />
      </section>
    </div>
  );
}
