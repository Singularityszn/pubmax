import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import JsonLd from "@/components/seo/JsonLd";
import SiteNav from "@/components/nav/SiteNav";
import { loadGroupedVenues } from "@/lib/venueDataset";
import { buildLeagueTable, indexSummary } from "@/lib/pintIndex";
import { formatPrice } from "@/lib/venues";
import {
  dataFileModified,
  formatMonthYear,
  formatObservedDate,
  isoDate,
  PINT_DATASET_FILE,
} from "@/lib/dataFreshness";

import "./pint-index.css";

// The London Pint Index (Wave S3.3) — the citable artifact. A server-rendered,
// zero-client-JS borough league table built from the tracked pint dataset, with
// a methodology + provenance section, a Dataset JSON-LD node (what AI engines
// love most), and a downloadable CSV (app/pint-index/data.csv). Every figure is
// derived from the data; nothing invented, and freshness is a dated observation
// window — never "live". The page is quarterly by nature (prices move slowly),
// so it stamps WHEN the underlying dataset was last observed rather than
// implying a live feed.

const SITE_URL = "https://pubmaxxing.com";

export const metadata: Metadata = {
  title: "The London Pint Index — average pint price by borough · PUBMAXXING",
  description:
    "A borough-by-borough league table of London pint prices — average, cheapest and dearest tracked pint per borough, derived from PUBMAXXING's tracked pint dataset. Methodology, provenance and a downloadable CSV. Never invented, never a live feed.",
  alternates: { canonical: "/pint-index" },
  openGraph: {
    title: "The London Pint Index — average pint price by borough",
    description:
      "Average, cheapest and dearest tracked pint per London borough, with methodology, provenance and a downloadable CSV.",
    type: "website",
    url: "/pint-index",
  },
  twitter: {
    card: "summary_large_image",
    title: "The London Pint Index — average pint price by borough",
    description:
      "Average, cheapest and dearest tracked pint per London borough, with methodology and a downloadable CSV.",
  },
};

// Dataset structured data (Wave S1.3 / S3.3). Only fields we can honestly back:
// name, description, temporalCoverage (observation date), dateModified, a
// human-readable creator, and a CSV distribution. No fabricated licence terms.
function datasetJsonLd(observedAt: Date, boroughCount: number, pubCount: number) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "The London Pint Index",
    description: `Average, cheapest and dearest tracked pint price across ${boroughCount} London boroughs, covering ${pubCount} tracked pubs. Derived from PUBMAXXING's tracked pint dataset.`,
    url: `${SITE_URL}/pint-index`,
    creator: {
      "@type": "Organization",
      name: "PUBMAXXING",
      url: SITE_URL,
    },
    isAccessibleForFree: true,
    dateModified: isoDate(observedAt),
    temporalCoverage: isoDate(observedAt),
    measurementTechnique:
      "Community Pint Drops plus scheduled permissible first-party price refreshes; competitor price aggregators are never scraped.",
    variableMeasured: "Pint price (GBP) per pub, aggregated per borough",
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "text/csv",
        contentUrl: `${SITE_URL}/pint-index/data.csv`,
      },
    ],
  };
}

export default async function PintIndexPage() {
  const venues = await loadGroupedVenues();
  const observedAt = await dataFileModified(PINT_DATASET_FILE);
  const rows = buildLeagueTable(venues);
  const summary = indexSummary(rows);
  const monthYear = formatMonthYear(observedAt);
  const observedDate = formatObservedDate(observedAt);

  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // Priced boroughs lead the table; the sort already put them first.
  const pricedRows = rows.filter((row) => row.averageGbp !== null);

  return (
    <main className="pintIndexPage">
      <JsonLd
        data={datasetJsonLd(observedAt, summary.boroughCount, summary.pubCount)}
        nonce={nonce}
      />
      <SiteNav />

      <header className="pintIndexHead">
        <p className="pintIndexEyebrow">The London Pint Index</p>
        <h1 className="pintIndexTitle">London pint prices, by borough</h1>
        <p className="pintIndexDek">
          A borough-by-borough league table of the pints PUBMAXXING tracks —
          average, cheapest and dearest per area. Built straight from the tracked
          pint dataset, sorted cheapest-average first.
        </p>
        <p className="pintIndexStamp">
          Prices last observed {observedDate}, from PUBMAXXING&rsquo;s tracked
          pint dataset &mdash; never a live feed.
        </p>

        {summary.averageGbp !== null ? (
          <dl className="pintIndexStats">
            <div className="pintIndexStat">
              <dt>Average pint</dt>
              <dd>{formatPrice(summary.averageGbp)}</dd>
            </div>
            <div className="pintIndexStat">
              <dt>Cheapest borough</dt>
              <dd>
                {formatPrice(summary.cheapestBorough?.averageGbp ?? null)}
                {summary.cheapestBorough ? (
                  <small>{summary.cheapestBorough.name}</small>
                ) : null}
              </dd>
            </div>
            <div className="pintIndexStat">
              <dt>Dearest borough</dt>
              <dd>
                {formatPrice(summary.dearestBorough?.averageGbp ?? null)}
                {summary.dearestBorough ? (
                  <small>{summary.dearestBorough.name}</small>
                ) : null}
              </dd>
            </div>
            <div className="pintIndexStat">
              <dt>Tracked pubs</dt>
              <dd>
                {summary.pubCount}
                <small>
                  across {summary.boroughCount}{" "}
                  {summary.boroughCount === 1 ? "borough" : "boroughs"}
                </small>
              </dd>
            </div>
          </dl>
        ) : null}
      </header>

      <section className="pintIndexSection" aria-labelledby="leagueHeading">
        <h2 id="leagueHeading" className="pintIndexSectionTitle">
          Borough league table
        </h2>
        <p className="pintIndexSectionDek">
          As of {monthYear}, ranked by the average tracked pint. Each borough
          links to its full cheapest-first pub list.
        </p>
        {rows.length === 0 ? (
          <p className="pintIndexNote">
            The pint dataset couldn&rsquo;t be read at build time, so the league
            table is empty. No figures are shown rather than invented ones.
          </p>
        ) : (
          <div className="pintIndexTableWrap">
            <table className="pintIndexTable">
              <caption className="srOnly">
                London boroughs ranked by average tracked pint price
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="pintIndexNum">
                    #
                  </th>
                  <th scope="col">Borough</th>
                  <th scope="col" className="pintIndexNum">
                    Average
                  </th>
                  <th scope="col" className="pintIndexNum">
                    Cheapest
                  </th>
                  <th scope="col" className="pintIndexNum">
                    Dearest
                  </th>
                  <th scope="col" className="pintIndexNum">
                    Tracked pubs
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.slug}>
                    <td className="pintIndexNum pintIndexRank">
                      {row.averageGbp === null ? "—" : index + 1}
                    </td>
                    <th scope="row">
                      <Link
                        href={`/borough/${row.slug}`}
                        className="pintIndexBoroughLink"
                      >
                        {row.name}
                      </Link>
                    </th>
                    <td className="pintIndexNum pintIndexAvg">
                      {row.averageGbp === null ? (
                        <span className="pintIndexNoPrice">No price</span>
                      ) : (
                        formatPrice(row.averageGbp)
                      )}
                    </td>
                    <td className="pintIndexNum">
                      {row.minGbp === null ? (
                        <span className="pintIndexNoPrice">—</span>
                      ) : (
                        formatPrice(row.minGbp)
                      )}
                    </td>
                    <td className="pintIndexNum">
                      {row.maxGbp === null ? (
                        <span className="pintIndexNoPrice">—</span>
                      ) : (
                        formatPrice(row.maxGbp)
                      )}
                    </td>
                    <td className="pintIndexNum">{row.pubCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <a className="pintIndexDownload" href="/pint-index/data.csv" download>
          Download the data (CSV) ↓
        </a>
      </section>

      {/* Biggest movers: honestly omitted. The only dated price snapshots in the
          repo (public/data/drink_price_updates/) are same-day per-drink demo
          fixtures — not a borough-level pint time series — so there is no
          honest earliest-vs-latest comparison to draw. Rather than invent a
          movement, we say so. */}
      <section className="pintIndexSection" aria-labelledby="moversHeading">
        <h2 id="moversHeading" className="pintIndexSectionTitle">
          Biggest movers
        </h2>
        <p className="pintIndexSectionDek">
          Not yet available. Showing which boroughs rose or fell needs at least
          two dated observations of the same borough&rsquo;s prices, and the
          tracked dataset currently ships a single observation window. Once a
          second quarterly snapshot lands, the movers will appear here —
          computed, not estimated.
        </p>
      </section>

      <section className="pintIndexSection" aria-labelledby="methodHeading">
        <h2 id="methodHeading" className="pintIndexSectionTitle">
          Methodology &amp; provenance
        </h2>
        <div className="pintIndexProse">
          <p>
            <strong>What a figure means.</strong> For each pub we track its{" "}
            <strong>cheapest tracked pint</strong> — the same price the borough
            pages rank by. A borough&rsquo;s average is the mean of those
            per-pub cheapest pints; its cheapest and dearest are the lowest and
            highest of them. Pubs we haven&rsquo;t priced yet are counted as
            mapped but never move the average.
          </p>
          <p>
            <strong>Where the prices come from.</strong> Two permissible
            sources, and only these. The live signal is{" "}
            <strong>community Pint Drops</strong> — prices logged by drinkers,
            attributed as contributions, not a live feed. Between drops, a
            scheduled refresh fills in prices from{" "}
            <strong>permissible first-party sources</strong> (a pub or
            brewery&rsquo;s own published menu, or an open-licensed dataset),
            each carrying its source and an observed-at date. A fresher community
            observation always beats a scheduled one.
          </p>
          <p>
            <strong>What we never do.</strong> We never scrape competitor
            price-aggregator or review sites, and we never present a stale price
            as live — every figure here is stamped with the date the dataset was
            last observed ({observedDate}). No price is invented; a borough with
            no tracked pint shows no price rather than a guess.
          </p>
        </div>
        <p className="pintIndexNote">
          This is a snapshot of the pints PUBMAXXING has observed, not a census
          of every pint poured in London. Coverage grows as more pints are
          dropped and refreshed.
        </p>
      </section>

      {pricedRows.length > 0 ? (
        <section className="pintIndexSection" aria-labelledby="boroughsHeading">
          <h2 id="boroughsHeading" className="pintIndexSectionTitle">
            Every tracked borough
          </h2>
          <p className="pintIndexSectionDek">
            Jump straight to any borough&rsquo;s cheapest-first pub list.
          </p>
          <ul className="pintIndexBoroughLinks">
            {pricedRows.map((row) => (
              <li key={row.slug}>
                <Link href={`/borough/${row.slug}`}>{row.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="pintIndexFootnote">
        Every pint has a story.{" "}
        <Link href="/borough">Browse the boroughs →</Link> ·{" "}
        <Link href="/historic">Historic pubs →</Link> ·{" "}
        <Link href="/map">Open the map →</Link>
      </p>
    </main>
  );
}
