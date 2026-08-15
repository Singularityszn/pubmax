import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import { formatObservedDate } from "@/lib/dataFreshness";
import {
  type DrinkBrandLandingRow,
  formatDrinkBrandLandingPublisherStatus,
} from "@/lib/drinkBrandLanding";
import type { DrinkBrandAreaLanding } from "@/lib/drinkBrandAreaLanding";
import { formatPrice } from "@/lib/venues";

function formatCollectedDate(iso: string): string {
  return formatObservedDate(new Date(iso));
}

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

function PublisherDisclosure({ row }: { row: DrinkBrandLandingRow }) {
  return row.publisher ? (
    <span className="drinkBrandAreaLanding__publisher">
      <span>Publisher: </span>
      <a href={row.publisher.url} target="_blank" rel="noopener noreferrer">
        {row.publisher.label}
      </a>
    </span>
  ) : (
    <span className="drinkBrandAreaLanding__publisher">
      Publisher not recorded
    </span>
  );
}

function HeroPublisherDisclosure({ row }: { row: DrinkBrandLandingRow }) {
  const status = formatDrinkBrandLandingPublisherStatus(row.publisher);

  return (
    <span className="drinkBrandAreaLanding__fromPublisher">
      {row.publisher ? (
        <a href={row.publisher.url} target="_blank" rel="noopener noreferrer">
          {status}
        </a>
      ) : (
        status
      )}
    </span>
  );
}

export default function DrinkBrandAreaLandingContent({
  landing,
}: {
  landing: DrinkBrandAreaLanding;
}) {
  const firstRow = landing.rows[0];

  return (
    <>
      <header className="drinkBrandAreaLanding__head">
        <p className="drinkBrandAreaLanding__eyebrow">
          <Link href="/map">London map</Link> <span aria-hidden="true">·</span>{" "}
          <Link href={`/area/${encodeURIComponent(landing.areaSlug)}`}>
            {landing.areaName}
          </Link>{" "}
          <span aria-hidden="true">·</span> {landing.brandLabel}
        </p>
        <h1>
          Cheapest {landing.brandLabel} pints in {landing.areaName}
        </h1>
        <p className="drinkBrandAreaLanding__from">
          <strong>From {formatPrice(firstRow.priceGbp)}</strong>
          <HeroPublisherDisclosure row={firstRow} />
        </p>
        <p className="drinkBrandAreaLanding__summary">
          {landing.totalPricedVenues} venues with listed {landing.brandLabel} pints. Collected{" "}
          {formatCollectedDate(landing.collectedAt)}.
        </p>
        <div className="drinkBrandAreaLanding__actions">
          <Link
            className="drinkBrandAreaLanding__primary"
            href={mapHref(landing)}
          >
            Open {landing.areaName} on Map
          </Link>
        </div>
      </header>

      <section
        className="drinkBrandAreaLanding__prices"
        aria-labelledby="drink-brand-area-price-heading"
      >
        <div className="drinkBrandAreaLanding__sectionHead">
          <h2 id="drink-brand-area-price-heading">Venue Ledger</h2>
          <span>{landing.totalPricedVenues} venues</span>
        </div>
        <ol className="drinkBrandAreaLanding__list" role="list">
          {landing.rows.map((row) => (
            <li className="drinkBrandAreaLanding__row" key={row.venueId}>
              <span
                className="drinkBrandAreaLanding__rank"
                aria-label={`Rank ${row.rank}`}
              >
                {row.rank}
              </span>
              <div className="drinkBrandAreaLanding__details">
                <Link
                  className="drinkBrandAreaLanding__venue"
                  href={ledgerHref(row.venueId)}
                >
                  {row.venueName}
                </Link>
                <span className="drinkBrandAreaLanding__borough">
                  {row.borough}
                </span>
                <span className="drinkBrandAreaLanding__pint">
                  {row.pintName}
                </span>
                <PublisherDisclosure row={row} />
                <Link
                  className="drinkBrandAreaLanding__contribution"
                  href={mapHref(landing, row.venueId)}
                >
                  Log this price
                </Link>
              </div>
              <PriceBadge
                variant="current"
                className="drinkBrandAreaLanding__price"
              >
                {formatPrice(row.priceGbp)}
              </PriceBadge>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
