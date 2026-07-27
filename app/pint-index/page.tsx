import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import NationalPintBenchmarks from "@/components/pintindex/NationalPintBenchmarks";
import PintIndexArrival from "@/components/pintindex/PintIndexArrival";
import PintIndexEditions from "@/components/pintindex/PintIndexEditions";
import PintIndexLeagueTable from "@/components/pintindex/PintIndexLeagueTable";
import ZonePintIndexStrip from "@/components/zones/ZonePintIndexStrip";
import { formatObservedDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { citableNationalBenchmarks, NATIONAL_PINT_BENCHMARKS } from "@/lib/nationalPintBenchmarks";
import { buildLeagueTable, dearestFirst, formatPintIndexDate, indexSummary, type PintIndexSnapshot } from "@/lib/pintIndex";
import { londonMonthOf, pintIndexMonthCloseDay, pintIndexMonthLabel } from "@/lib/pintIndexArchive";
import { arrivalAreas } from "@/lib/pintIndexArrival";
import { loadPintIndexArchive, loadPublicPintIndexSnapshot } from "@/lib/pintIndexSnapshot.server";
import { loadGroupedVenues } from "@/lib/venueDataset";
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

export default async function PintIndexPage() {
  const [snapshot, zoneIndex, editions, venues] = await Promise.all([
    loadPublicPintIndexSnapshot(),
    loadZonePintIndex(),
    loadPintIndexArchive(),
    loadGroupedVenues(),
  ]);
  const rows = snapshot ? buildLeagueTable(snapshot) : [];
  const summary = indexSummary(rows);
  const jsonLd = snapshot ? datasetJsonLd(snapshot, summary.boroughCount, summary.pubCount) : null;
  const nonce = jsonLd ? (await headers()).get("x-nonce") ?? undefined : undefined;
  const window = snapshot?.observationWindow;
  // The month currently filling, and the day it closes and gets its own dated
  // page. Read at render time on purpose: this is the one live claim on the
  // page, and it must move with the calendar rather than harden into a stale
  // promise about a month that already ended. Read on the London calendar the
  // closing date beside it is printed in, not in UTC.
  const openMonth = londonMonthOf(new Date());
  // Other people's figures, dropped unless they carry a publisher, a link and a
  // published day. They are rendered in their own block and never merged into
  // anything above: see the hard rule in lib/nationalPintBenchmarks.ts.
  const national = citableNationalBenchmarks(NATIONAL_PINT_BENCHMARKS);
  const dearestPint = summary.dearestPint;

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
            {`Observation window: ${formatPintIndexDate(window.start)} to ${formatPintIndexDate(window.end)}.`}
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

      {national.length > 0 ? (
        <section className="pintIndexSection" aria-labelledby="nationalHeading">
          <h2 id="nationalHeading" className="pintIndexSectionTitle">What a pint costs nationally</h2>
          <p className="pintIndexSectionDek">
            None of these figures are ours. They are here so the prices on this
            page have something to sit against, and each one names who counted
            it, when, and exactly what they counted. A national cask ale is not
            a London pint.
          </p>
          <NationalPintBenchmarks rows={national} headingId="nationalHeading" />
        </section>
      ) : null}

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

      <PintIndexArrival
        areas={arrivalAreas(venues)}
        surface="index"
        collectedLabel={`collected ${formatObservedDate(PINT_DATASET_OBSERVED_AT)}`}
      />

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
          <PintIndexLeagueTable
            rows={rows}
            caption="London boroughs ranked by average eligible observed pint price"
          />
        )}
        <a className="pintIndexDownload" href="/pint-index/data.csv" download>Download the public snapshot (CSV) ↓</a>
      </section>

      {dearestPint ? (
        <section className="pintIndexSection" id="dearest" aria-labelledby="dearestHeading">
          <h2 id="dearestHeading" className="pintIndexSectionTitle">The dearest end</h2>
          <p className="pintIndexSectionDek">
            Cheapest first is the default above, because that is what you want
            on a Friday. This is the same table the other way up, ranked on the
            priciest pint each borough has on record. Top of it right now:{" "}
            {formatPrice(dearestPint.maxGbp)} at {dearestPint.maxPubName},{" "}
            {dearestPint.name}.
          </p>
          <PintIndexLeagueTable
            rows={dearestFirst(rows)}
            caption="London boroughs ranked by their dearest eligible observed pint price"
            highlight="dearest"
          />
        </section>
      ) : null}

      <section className="pintIndexSection" aria-labelledby="editionsHeading">
        <h2 id="editionsHeading" className="pintIndexSectionTitle">Dated editions</h2>
        <p className="pintIndexSectionDek">
          This page moves as prices land, which is no use to anyone quoting it.
          So every closed month also gets its own page, frozen the day it goes
          up. {pintIndexMonthLabel(openMonth)} closes on{" "}
          {formatPintIndexDate(pintIndexMonthCloseDay(openMonth))} and gets
          one next. Anything logged with a public source and the day it was seen
          before then lands in it.
        </p>
        <PintIndexEditions editions={editions} />
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
