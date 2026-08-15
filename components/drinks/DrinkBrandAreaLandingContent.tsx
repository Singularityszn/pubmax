import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import {
  DrinkBrandPublisherDisclosure,
  formatDrinkBrandCollectedDate,
} from "@/components/drinks/DrinkBrandDirectory";
import type { DrinkBrandAreaLanding } from "@/lib/drinkBrandAreaLanding";
import { formatPrice } from "@/lib/venues";

function mapHref(
  landing: DrinkBrandAreaLanding,
  venueId?: string,
): string {
  const params = new URLSearchParams();
  params.set("q", landing.areaName);
  params.set("drink", "beer");
  params.set("brand", landing.brandSlug);
  if (venueId) {
    params.set("sel", venueId);
    params.set("log", "1");
  }
  return `/map?${params.toString()}`;
}

function ledgerHref(venueId: string): string {
  return `/ledger/${encodeURIComponent(venueId)}`;
}

export default function DrinkBrandAreaLandingContent({
  landing,
}: {
  landing: DrinkBrandAreaLanding;
}) {
  const firstRow = landing.rows[0];
  const renderedVenueCount = landing.rows.length;
  const venueCountLabel =
    landing.totalPricedVenues > renderedVenueCount
      ? `Showing ${renderedVenueCount} of ${landing.totalPricedVenues} venues`
      : `${landing.totalPricedVenues} venues`;

  return (
    <div className="drinkBrandDirectory">
      <header className="drinkBrandDirectory__head drinkBrandAreaLanding__head">
        <p className="drinkBrandDirectory__eyebrow drinkBrandAreaLanding__eyebrow">
          <Link href="/map">London map</Link> <span aria-hidden="true">·</span>{" "}
          <Link href={`/area/${encodeURIComponent(landing.areaSlug)}`}>
            {landing.areaName}
          </Link>{" "}
          <span aria-hidden="true">·</span> {landing.brandLabel}
        </p>
        <h1>
          Cheapest {landing.brandLabel} pints in {landing.areaName}
        </h1>
        <p className="drinkBrandDirectory__from drinkBrandAreaLanding__from">
          <strong>From {formatPrice(firstRow.priceGbp)}</strong>
          <DrinkBrandPublisherDisclosure
            className="drinkBrandAreaLanding__fromPublisher drinkBrandDirectory__fromPublisher"
            row={firstRow}
            variant="hero"
          />
        </p>
        <p className="drinkBrandDirectory__summary drinkBrandAreaLanding__summary">
          {landing.totalPricedVenues} venues with listed {landing.brandLabel} pints. Collected{" "}
          {formatDrinkBrandCollectedDate(landing.collectedAt)}.
        </p>
        <div className="drinkBrandDirectory__actions drinkBrandAreaLanding__actions">
          <Link
            className="drinkBrandDirectory__primary drinkBrandAreaLanding__primary"
            href={mapHref(landing)}
          >
            Open {landing.areaName} on Map
          </Link>
        </div>
      </header>

      <section
        className="drinkBrandDirectory__prices drinkBrandAreaLanding__prices"
        aria-labelledby="drink-brand-area-price-heading"
      >
        <div className="drinkBrandDirectory__sectionHead drinkBrandAreaLanding__sectionHead">
          <h2 id="drink-brand-area-price-heading">Venue Ledger</h2>
          <span className="drinkBrandDirectory__sectionCount drinkBrandAreaLanding__sectionCount">
            {venueCountLabel}
          </span>
        </div>
        <ol
          className="drinkBrandDirectory__list drinkBrandAreaLanding__list"
          role="list"
        >
          {landing.rows.map((row) => (
            <li
              className="drinkBrandDirectory__row drinkBrandAreaLanding__row"
              key={row.venueId}
            >
              <span
                className="drinkBrandDirectory__rank drinkBrandAreaLanding__rank"
                aria-label={`Rank ${row.rank}`}
              >
                {row.rank}
              </span>
              <div className="drinkBrandDirectory__details drinkBrandAreaLanding__details">
                <Link
                  className="drinkBrandDirectory__venue drinkBrandAreaLanding__venue"
                  href={ledgerHref(row.venueId)}
                >
                  {row.venueName}
                </Link>
                <span className="drinkBrandDirectory__borough drinkBrandAreaLanding__borough">
                  {row.borough}
                </span>
                <span className="drinkBrandDirectory__pint drinkBrandAreaLanding__pint">
                  {row.pintName}
                </span>
                <DrinkBrandPublisherDisclosure
                  className="drinkBrandAreaLanding__publisher drinkBrandDirectory__publisher"
                  row={row}
                />
                <Link
                  className="drinkBrandDirectory__contribution drinkBrandAreaLanding__contribution"
                  href={mapHref(landing, row.venueId)}
                >
                  Log this price
                </Link>
              </div>
              <PriceBadge
                variant="current"
                className="drinkBrandDirectory__price drinkBrandAreaLanding__price"
              >
                {formatPrice(row.priceGbp)}
              </PriceBadge>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
