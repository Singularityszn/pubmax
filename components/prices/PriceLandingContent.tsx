import Link from "next/link";

import { formatPrice } from "@/lib/venues";

export type PriceLandingRow = {
  venueId: string;
  name: string;
  borough: string;
  priceGbp: number;
  pintName: string;
  publisher: { label: string; url: string } | null;
};

export default function PriceLandingContent({
  eyebrow,
  title,
  summary,
  mapHref,
  mapLabel,
  rankedHeading,
  rows,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  mapHref: string;
  mapLabel: string;
  rankedHeading: string;
  rows: readonly PriceLandingRow[];
}) {
  return (
    <div className="priceLandingContent">
      <header className="priceLandingHead">
        <p className="priceLandingEyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="priceLandingSummary">{summary}</p>
        <Link className="priceLandingMapLink" href={mapHref}>
          {mapLabel}
        </Link>
      </header>

      <section className="priceLandingRanked" aria-labelledby="priceLandingRankedHeading">
        <div className="priceLandingRankedHead">
          <h2 id="priceLandingRankedHeading">{rankedHeading}</h2>
          <span>Cheapest pint</span>
        </div>
        <ol className="priceLandingList">
          {rows.map((row, index) => (
            <li className="priceLandingRow" key={row.venueId}>
              <span className="priceLandingRank" aria-label={`Rank ${index + 1}`}>
                {index + 1}
              </span>
              <span className="priceLandingVenue">
                <Link className="priceLandingVenueLink" href={`/ledger/${row.venueId}`}>
                  <span className="priceLandingName">{row.name}</span>
                  <span className="priceLandingMeta">
                    {row.borough} · {row.pintName}
                  </span>
                </Link>
                {row.publisher ? (
                  <a
                    className="priceLandingPublisher"
                    href={row.publisher.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Publisher: {row.publisher.label}
                  </a>
                ) : (
                  <span className="priceLandingPublisher">Publisher not recorded</span>
                )}
              </span>
              <Link
                className="priceLandingPrice"
                href={`/ledger/${row.venueId}`}
                aria-label={`${row.name}, ${formatPrice(row.priceGbp)}`}
              >
                {formatPrice(row.priceGbp)}
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
