import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import ZonePintIndexStrip from "@/components/zones/ZonePintIndexStrip";
import { buildLeagueTable, indexSummary, type PintIndexSnapshot } from "@/lib/pintIndex";
import { loadPublicPintIndexSnapshot } from "@/lib/pintIndexSnapshot.server";
import { formatPrice } from "@/lib/venues";
import { loadZonePintIndex } from "@/lib/zonePintIndex.server";

import "./pint-index.css";

const SITE_URL = "https://pubmaxxing.com";

export const metadata: Metadata = {
  title: "The London Pint Index: public data status · PUBMAXX",
  description: "The public London Pint Index, with explicit source, licence and observation-date validation. Unverified legacy prices are excluded.",
  alternates: { canonical: "/pint-index" },
  openGraph: {
    title: "The London Pint Index: public data status",
    description: "A provenance-first London pint-price dataset. Only citable observations with explicit sources and dates are published.",
    type: "website",
    url: "/pint-index",
  },
  twitter: {
    card: "summary_large_image",
    title: "The London Pint Index: public data status",
    description: "Only citable pint-price observations with explicit sources and dates are published.",
  },
};

function datasetJsonLd(snapshot: PintIndexSnapshot, boroughCount: number, pubCount: number) {
  if (!snapshot.observationWindow || snapshot.observations.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "The London Pint Index",
    description: `A provenance-validated snapshot covering ${pubCount} pubs across ${boroughCount} London boroughs.`,
    url: `${SITE_URL}/pint-index`,
    creator: { "@type": "Organization", name: "PUBMAXX", url: SITE_URL },
    isAccessibleForFree: true,
    dateModified: snapshot.generatedAt,
    temporalCoverage: `${snapshot.observationWindow.start}/${snapshot.observationWindow.end}`,
    measurementTechnique: "Confirmed Pint Drops, official pub or brewery sources, and explicitly licensed open datasets with observed-at dates; classified by London borough point-in-polygon boundaries.",
    variableMeasured: "Observed pint price in GBP, aggregated per London borough",
    distribution: [{
      "@type": "DataDownload",
      encodingFormat: "text/csv",
      contentUrl: `${SITE_URL}/pint-index/data.csv`,
    }],
  };
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" }).format(new Date(value));
}

export default async function PintIndexPage() {
  const [snapshot, zoneIndex] = await Promise.all([
    loadPublicPintIndexSnapshot(),
    loadZonePintIndex(),
  ]);
  const rows = snapshot ? buildLeagueTable(snapshot) : [];
  const summary = indexSummary(rows);
  const jsonLd = snapshot ? datasetJsonLd(snapshot, summary.boroughCount, summary.pubCount) : null;
  const nonce = jsonLd ? (await headers()).get("x-nonce") ?? undefined : undefined;
  const window = snapshot?.observationWindow;

  return (
    <main className="pintIndexPage">
      {jsonLd ? <JsonLd data={jsonLd} nonce={nonce} /> : null}
      <SiteNav />

      <header className="pintIndexHead">
        <p className="pintIndexEyebrow">The London Pint Index</p>
        <h1 className="pintIndexTitle">
          {rows.length ? "London pint prices, by borough" : "London pint prices, by fare zone"}
        </h1>
        {window ? (
          <p className="pintIndexStamp">
            {`Observation window: ${formatDate(window.start)} to ${formatDate(window.end)}.`}
          </p>
        ) : null}

        {summary.averageGbp !== null ? (
          <dl className="pintIndexStats">
            <div className="pintIndexStat"><dt>Average pint</dt><dd>{formatPrice(summary.averageGbp)}</dd></div>
            <div className="pintIndexStat"><dt>Cheapest borough</dt><dd>{formatPrice(summary.cheapestBorough?.averageGbp ?? null)}<small>{summary.cheapestBorough?.name}</small></dd></div>
            <div className="pintIndexStat"><dt>Dearest borough</dt><dd>{formatPrice(summary.dearestBorough?.averageGbp ?? null)}<small>{summary.dearestBorough?.name}</small></dd></div>
            <div className="pintIndexStat"><dt>Eligible pubs</dt><dd>{summary.pubCount}<small>across {summary.boroughCount} boroughs</small></dd></div>
          </dl>
        ) : null}
      </header>

      <section className="pintIndexSection" aria-labelledby="zoneHeading">
        <h2 id="zoneHeading" className="pintIndexSectionTitle">The Zone pint index</h2>
        <p className="pintIndexNote">
          A pint in Zone 1 costs more than Zone 3. Here is by how much. Each pub
          is placed in its <strong>nearest station&rsquo;s</strong>{" "}TfL fare zone
          (a documented approximation, not an area boundary), then we take the
          median of every zone&rsquo;s observed cheapest pint.
        </p>
        <ZonePintIndexStrip index={zoneIndex} />
      </section>

      <section className="pintIndexSection" aria-labelledby="leagueHeading">
        <h2 id="leagueHeading" className="pintIndexSectionTitle">Borough league table</h2>
        {rows.length === 0 ? (
          <p className="pintIndexNote">
            <strong>No price logged here yet.</strong> Yours to set. The zone
            strip above rolls up every price on the map; this league is stricter
            and only counts prices that carry a public source and an observed-at
            date, so an area can post a zone median above and still sit empty
            here. We&rsquo;d rather show nothing than a guess, so the league
            table opens the moment real, cited prices land. No file timestamp
            counts as a price date, and no excluded price is ever swapped in.
          </p>
        ) : (
          <div className="pintIndexTableWrap">
            <table className="pintIndexTable">
              <caption className="srOnly">London boroughs ranked by average eligible observed pint price</caption>
              <thead><tr><th scope="col" className="pintIndexNum">#</th><th scope="col">Borough</th><th scope="col" className="pintIndexNum">Average</th><th scope="col" className="pintIndexNum">Cheapest</th><th scope="col" className="pintIndexNum">Dearest</th><th scope="col" className="pintIndexNum">Eligible pubs</th></tr></thead>
              <tbody>{rows.map((row, index) => (
                <tr key={row.slug}>
                  <td className="pintIndexNum pintIndexRank">{index + 1}</td>
                  <th scope="row"><Link href={`/borough/${row.slug}`} className="pintIndexBoroughLink">{row.name}</Link></th>
                  <td className="pintIndexNum pintIndexAvg">{formatPrice(row.averageGbp)}</td>
                  <td className="pintIndexNum">{formatPrice(row.minGbp)}</td>
                  <td className="pintIndexNum">{formatPrice(row.maxGbp)}</td>
                  <td className="pintIndexNum">{row.pubCount}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <a className="pintIndexDownload" href="/pint-index/data.csv" download>Download the public snapshot (CSV) ↓</a>
      </section>

      <section className="pintIndexSection" aria-labelledby="methodHeading">
        <h2 id="methodHeading" className="pintIndexSectionTitle">Methodology &amp; provenance</h2>
        <p className="pintIndexNote pintIndexMethodLede">Only observations with a public source and observed-at date are published. The legacy map baseline is excluded.</p>
        <div className="pintIndexProse">
          <p><strong>Eligible evidence.</strong> Community submissions, a pub or brewery&rsquo;s own published material, and properly licensed open data may enter the public Index only with a public source URL and observed-at date.</p>
          <p><strong>Borough classification.</strong> Coordinates are assigned using point-in-polygon against the versioned Greater London boundary artifact. A point outside every polygon remains unclassified; it is never snapped to an arbitrary nearest borough.</p>
          <p><strong>Quarantine.</strong> The existing map experience may still use a legacy third-party-derived baseline for product continuity. Those rows are excluded from this public, citable Index and from its CSV and structured data.</p>
          <p><strong>Freshness.</strong> Observation dates come from the evidence record. Build time and file modification time are never presented as when a price was seen.</p>
        </div>
      </section>

      <p className="pintIndexFootnote"><Link href="/historic">Explore cited historic pubs →</Link> · <Link href="/map">Open the map →</Link></p>
    </main>
  );
}
