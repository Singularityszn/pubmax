import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import { formatObservedDate } from "@/lib/dataFreshness";
import {
  type DrinkBrandLanding,
  type DrinkBrandLandingRow,
  formatDrinkBrandLandingPublisherStatus,
} from "@/lib/drinkBrandLanding";
import { formatPrice } from "@/lib/venues";

function formatCollectedDate(iso: string): string {
  return formatObservedDate(new Date(iso));
}

function mapHref(slug: string): string {
  return `/map?drink=beer&brand=${encodeURIComponent(slug)}`;
}

function contributionHref(slug: string): string {
  return `${mapHref(slug)}&log=1`;
}

function PublisherDisclosure({
  className,
  row,
}: {
  className: string;
  row: DrinkBrandLandingRow;
}) {
  return (
    <span className={className}>
      {row.publisher ? (
        <>
          <span>Publisher: </span>
          <a
            href={row.publisher.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.publisher.label}
          </a>
        </>
      ) : (
        "Publisher not recorded"
      )}
    </span>
  );
}

function HeroPublisherDisclosure({ row }: { row: DrinkBrandLandingRow }) {
  const status = formatDrinkBrandLandingPublisherStatus(row.publisher);

  return (
    <span className="drinkBrandLanding__fromPublisher">
      {row.publisher ? (
        <a
          href={row.publisher.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {status}
        </a>
      ) : (
        status
      )}
    </span>
  );
}

export default function DrinkBrandLandingContent({
  landing,
}: {
  landing: DrinkBrandLanding;
}) {
  const firstRow = landing.rows[0];
  const lowestPrice = formatPrice(firstRow.priceGbp);

  return (
    <>
      <header className="drinkBrandLanding__head">
        <p className="drinkBrandLanding__eyebrow">
          <Link href="/map">London map</Link> <span aria-hidden="true">·</span>{" "}
          {landing.brandLabel}
        </p>
        <h1>Cheapest {landing.brandLabel} Pints in London</h1>
        <p className="drinkBrandLanding__from">
          <strong>From {lowestPrice}</strong>
          <HeroPublisherDisclosure row={firstRow} />
        </p>
        <p className="drinkBrandLanding__summary">
          {landing.totalPricedVenues} venues with listed {landing.brandLabel} pints. Collected{" "}
          {formatCollectedDate(landing.collectedAt)}.
        </p>
        <nav className="drinkBrandLanding__actions" aria-label={`${landing.brandLabel} pint actions`}>
          <Link className="drinkBrandLanding__primary" href={mapHref(landing.slug)}>
            Find {landing.brandLabel} on Map
          </Link>
          <Link className="drinkBrandLanding__secondary" href={contributionHref(landing.slug)}>
            Log a {landing.brandLabel} Pint Price
          </Link>
        </nav>
      </header>

      <section
        className="drinkBrandLanding__prices"
        aria-labelledby="drink-brand-price-heading"
      >
        <div className="drinkBrandLanding__sectionHead">
          <h2 id="drink-brand-price-heading">Cheapest listed pints</h2>
        </div>
        <ol className="drinkBrandLanding__list">
          {landing.rows.map((row) => (
            <li className="drinkBrandLanding__row" key={row.venueId}>
              <span className="drinkBrandLanding__rank" aria-label={`Rank ${row.rank}`}>
                {row.rank}
              </span>
              <div className="drinkBrandLanding__details">
                <Link
                  className="drinkBrandLanding__venue"
                  href={`/ledger/${encodeURIComponent(row.venueId)}`}
                >
                  {row.venueName}
                </Link>
                <span className="drinkBrandLanding__borough">{row.borough}</span>
                <span className="drinkBrandLanding__pint">{row.pintName}</span>
                <PublisherDisclosure
                  className="drinkBrandLanding__publisher"
                  row={row}
                />
              </div>
              <PriceBadge variant="current" className="drinkBrandLanding__price">
                {formatPrice(row.priceGbp)}
              </PriceBadge>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
