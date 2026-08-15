import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import {
  type DrinkBrandLanding,
} from "@/lib/drinkBrandLanding";
import { formatPrice } from "@/lib/venues";
import {
  DrinkBrandPublisherDisclosure,
  formatDrinkBrandCollectedDate,
} from "@/components/drinks/DrinkBrandDirectory";

function mapHref(slug: string): string {
  return `/map?drink=beer&brand=${encodeURIComponent(slug)}`;
}

function contributionHref(slug: string): string {
  return `${mapHref(slug)}&log=1`;
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
      <header className="drinkBrandDirectory__head drinkBrandLanding__head">
        <p className="drinkBrandDirectory__eyebrow drinkBrandLanding__eyebrow">
          <Link href="/map">London map</Link> <span aria-hidden="true">·</span>{" "}
          {landing.brandLabel}
        </p>
        <h1>Cheapest {landing.brandLabel} Pints in London</h1>
        <p className="drinkBrandDirectory__from drinkBrandLanding__from">
          <strong>From {lowestPrice}</strong>
          <DrinkBrandPublisherDisclosure
            className="drinkBrandLanding__fromPublisher drinkBrandDirectory__fromPublisher"
            row={firstRow}
            variant="hero"
          />
        </p>
        <p className="drinkBrandDirectory__summary drinkBrandLanding__summary">
          {landing.totalPricedVenues} venues with listed {landing.brandLabel} pints. Collected{" "}
          {formatDrinkBrandCollectedDate(landing.collectedAt)}.
        </p>
        <nav
          className="drinkBrandDirectory__actions drinkBrandLanding__actions"
          aria-label={`${landing.brandLabel} pint actions`}
        >
          <Link
            className="drinkBrandDirectory__primary drinkBrandLanding__primary"
            href={mapHref(landing.slug)}
          >
            Find {landing.brandLabel} on Map
          </Link>
          <Link
            className="drinkBrandLanding__secondary"
            href={contributionHref(landing.slug)}
          >
            Log a {landing.brandLabel} Pint Price
          </Link>
        </nav>
      </header>

      <section
        className="drinkBrandDirectory__prices drinkBrandLanding__prices"
        aria-labelledby="drink-brand-price-heading"
      >
        <div className="drinkBrandDirectory__sectionHead drinkBrandLanding__sectionHead">
          <h2 id="drink-brand-price-heading">Cheapest listed pints</h2>
        </div>
        <ol className="drinkBrandDirectory__list drinkBrandLanding__list">
          {landing.rows.map((row) => (
            <li
              className="drinkBrandDirectory__row drinkBrandLanding__row"
              key={row.venueId}
            >
              <span
                className="drinkBrandDirectory__rank drinkBrandLanding__rank"
                aria-label={`Rank ${row.rank}`}
              >
                {row.rank}
              </span>
              <div className="drinkBrandDirectory__details drinkBrandLanding__details">
                <Link
                  className="drinkBrandDirectory__venue drinkBrandLanding__venue"
                  href={`/ledger/${encodeURIComponent(row.venueId)}`}
                >
                  {row.venueName}
                </Link>
                <span className="drinkBrandDirectory__borough drinkBrandLanding__borough">
                  {row.borough}
                </span>
                <span className="drinkBrandDirectory__pint drinkBrandLanding__pint">
                  {row.pintName}
                </span>
                <DrinkBrandPublisherDisclosure
                  className="drinkBrandLanding__publisher drinkBrandDirectory__publisher"
                  row={row}
                />
              </div>
              <PriceBadge
                variant="current"
                className="drinkBrandDirectory__price drinkBrandLanding__price"
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
