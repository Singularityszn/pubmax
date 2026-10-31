import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import NationalPintBenchmarks from "@/components/pintindex/NationalPintBenchmarks";
import ListedDrinkCoverage from "@/components/pintindex/ListedDrinkCoverage";
import { loadPricedPubCount } from "@/lib/pricedPubCount.server";
import BoroughCoverageStatus from "@/components/pintindex/BoroughCoverageStatus";
import PintIndexArrival from "@/components/pintindex/PintIndexArrival";
import PintIndexEditions from "@/components/pintindex/PintIndexEditions";
import PintIndexLeagueTable from "@/components/pintindex/PintIndexLeagueTable";
import ZonePintIndexStrip from "@/components/zones/ZonePintIndexStrip";
import { loadSeedBoroughCoverage } from "@/lib/boroughCoverageStatus.server";
import { citableNationalBenchmarks, NATIONAL_PINT_BENCHMARKS } from "@/lib/nationalPintBenchmarks";
import { buildLeagueTable, dearestFirst, formatPintIndexDate, indexSummary, PINT_INDEX_NOT_READY_LINE, pintIndexLeagueReady, type PintIndexSnapshot } from "@/lib/pintIndex";
import { londonMonthOf, pintIndexMeetsAdmissionFloor, pintIndexMonthCloseDay, pintIndexMonthLabel } from "@/lib/pintIndexArchive";
import { arrivalAreas } from "@/lib/pintIndexArrival";
import { loadPintIndexArchive, loadPublicPintIndexSnapshotOrThrow } from "@/lib/pintIndexSnapshot.server";
import { loadGroupedVenues } from "@/lib/venueDataset";
import { formatPrice } from "@/lib/venues";
import { loadZonePintIndex } from "@/lib/zonePintIndex.server";
import { computeZonePintIndex, formatZoneGbp, type ZonePintIndex } from "@/lib/zones";
import PintIndexScreen from "./PintIndexScreen";

import "@/components/listing/listing.css";
import "./pint-index.css";

const SITE_URL = "https://pubmaxxing.com";
const PAGE_TITLE = "London pint prices by borough and fare zone";
const PAGE_DESCRIPTION =
  "Compare London’s listed pint prices by fare zone. The borough league uses only prices with a public source and date.";

// LIVE IS NOT THE SAME AS INDEXED (captain decision D10). This route always
// serves a validated snapshot, including its valid empty state. The borough, About
// and method pages keep linking here. What follows the admission floor is the
// INDEX directive: a sitemap row is an invitation rather than an instruction, so
// dropping that row leaves a crawler free to arrive through any of those links
// and index a month with nothing behind it. `pintIndexMeetsAdmissionFloor`
// (lib/pintIndexArchive.ts) is the one rule, read here over the live snapshot, and
// `follow` stays on so the dated editions - real citations - are still reached.
export async function generateMetadata(): Promise<Metadata> {
  const snapshot = await loadPublicPintIndexSnapshotOrThrow();
  const promoted = pintIndexMeetsAdmissionFloor(snapshot);
  return {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    alternates: { canonical: "/pint-index" },
    robots: { index: promoted, follow: true },
    openGraph: {
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
      type: "website",
      url: "/pint-index",
    },
    twitter: {
      card: "summary_large_image",
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
    },
  };
}

// THE HEAD SAYS LONDON'S OWN FIGURE FIRST (taste plan, 18 Oct 2026). The page
// opened on a heading and a button, then three figures counted by other
// people, before a reader met a London price. The zone medians are London's,
// measured here, so the lede states the dearest and cheapest zone in one line.
// It says nothing when fewer than two zones clear the floor (lib/zones.ts).
function zoneLede(index: ZonePintIndex | null): string | null {
  if (!index?.dearest || !index.cheapest || index.dearest.zone === index.cheapest.zone) return null;
  return `Zone ${index.dearest.zone}'s median cheapest pint is ${formatZoneGbp(index.dearest.medianGbp)}. Zone ${index.cheapest.zone}'s is ${formatZoneGbp(index.cheapest.medianGbp)}.`;
}

function datasetJsonLd(snapshot: PintIndexSnapshot, boroughCount: number, pubCount: number) {
  if (!snapshot.observationWindow || snapshot.observations.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "The London Pint Index",
    description: `A dated London pint-price dataset covering ${pubCount} pubs across ${boroughCount} boroughs.`,
    url: `${SITE_URL}/pint-index`,
    creator: { "@type": "Organization", name: "PUBMAXX", url: SITE_URL },
    isAccessibleForFree: true,
    dateModified: snapshot.generatedAt,
    temporalCoverage: `${snapshot.observationWindow.start}/${snapshot.observationWindow.end}`,
    measurementTechnique: "Confirmed Pint Drops, official pub or brewery sources, and licensed open datasets with price dates, assigned to London boroughs from map boundaries.",
    variableMeasured: "Pint price in GBP, grouped by London borough",
    distribution: [{
      "@type": "DataDownload",
      encodingFormat: "text/csv",
      contentUrl: `${SITE_URL}/pint-index/data.csv`,
    }],
  };
}

export default async function PintIndexPage() {
  const [snapshot, zoneIndex, editions, venues] = await Promise.all([
    loadPublicPintIndexSnapshotOrThrow(),
    loadZonePintIndex(),
    loadPintIndexArchive(),
    loadGroupedVenues(),
  ]);
  // The ONE priced-pub count (lib/pricedPubCount.ts), the same read /about makes.
  const pricedPubs = await loadPricedPubCount(venues);
  const seedBoroughCoverage = await loadSeedBoroughCoverage(venues);
  const rows = buildLeagueTable(snapshot);
  const summary = indexSummary(rows);
  const jsonLd = datasetJsonLd(snapshot, summary.boroughCount, summary.pubCount);
  const nonce = jsonLd ? (await headers()).get("x-nonce") ?? undefined : undefined;
  const window = snapshot.observationWindow;
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

  const ledeZones = zoneLede(zoneIndex);
  const ledeWindow = window
    ? `Prices seen: ${formatPintIndexDate(window.start)} to ${formatPintIndexDate(window.end)}.`
    : null;
  const lede = [ledeZones, ledeWindow].filter(Boolean).join(" ") || undefined;

  // London's own figures come first, then the reader's own patch, then the
  // league and its history; the national yardstick follows them, because it is
  // context for London's numbers rather than the answer. A section with no
  // rows renders nothing, because a whole section saying there was nothing in
  // it was noise (taste plan, 18 Oct 2026). While the citable snapshot is
  // empty, ONE line says so, in the words /about uses (lib/pintIndex.ts).
  return (
    <main id="main" className="pintIndexPage listingShell">
      {jsonLd ? <JsonLd data={jsonLd} nonce={nonce} /> : null}
      <SiteNav />

      <PintIndexScreen
        title={PAGE_TITLE}
        lede={lede}
        csvHref={rows.length > 0 ? "/pint-index/data.csv" : undefined}
      >
        {summary.averageGbp !== null ? (
          <dl className="pintIndexStats">
            <div className="pintIndexStat"><dt>Average pint</dt><dd>{formatPrice(summary.averageGbp)}</dd></div>
            <div className="pintIndexStat"><dt>Cheapest borough</dt><dd>{formatPrice(summary.cheapestBorough?.averageGbp ?? null)}<small>{summary.cheapestBorough?.name}</small></dd></div>
            <div className="pintIndexStat"><dt>Dearest borough</dt><dd>{formatPrice(summary.dearestBorough?.averageGbp ?? null)}<small>{summary.dearestBorough?.name}</small></dd></div>
            <div className="pintIndexStat"><dt>Eligible pubs</dt><dd>{summary.pubCount}<small>across {summary.boroughCount} boroughs</small></dd></div>
          </dl>
        ) : null}

        <ListedDrinkCoverage coverage={pricedPubs.coverage} status={pricedPubs.status} />

        <section className="pintIndexSection" aria-labelledby="zoneHeading">
          <h2 id="zoneHeading" className="listingSectionTitle">By fare zone</h2>
          <p className="listingSectionDek">
            A pint in Zone 1 costs more than Zone 3. Here&rsquo;s how much more. Each pub
            is placed in its nearest station&rsquo;s TfL fare zone (a documented
            approximation, not an area boundary), then we take the median of every
            zone&rsquo;s listed cheapest pint.
          </p>
          <ZonePintIndexStrip index={zoneIndex ?? computeZonePintIndex([])} />
        </section>

        <PintIndexArrival
          areas={arrivalAreas(venues)}
          surface="index"
        />

        {/* The same words /about uses while the citable snapshot is empty, so
            the borough list above is never read as the dated league. */}
        {pintIndexLeagueReady(snapshot) ? null : (
          <p className="listingSectionDek pintIndexLeagueStatus" role="note">{PINT_INDEX_NOT_READY_LINE}</p>
        )}

        {rows.length > 0 ? (
          <section className="pintIndexSection" aria-labelledby="leagueHeading">
            <h2 id="leagueHeading" className="listingSectionTitle">Borough league table</h2>
            <PintIndexLeagueTable
              rows={rows}
              caption="London boroughs ranked by average eligible pint price"
            />
            <a className="pintIndexDownload" href="/pint-index/data.csv" download>Download current data (CSV)</a>
          </section>
        ) : null}

        {dearestPint ? (
          <section className="pintIndexSection" id="dearest" aria-labelledby="dearestHeading">
            <h2 id="dearestHeading" className="listingSectionTitle">The dearest end</h2>
            <p className="listingSectionDek">
              Cheapest first is the default above, because that is what you want
              on a Friday. This is the same table the other way up, ranked on the
              priciest pint each borough has on record. At the top of this dataset:{" "}
              {formatPrice(dearestPint.maxGbp)} at {dearestPint.maxPubName},{" "}
              {dearestPint.name}.
            </p>
            <PintIndexLeagueTable
              rows={dearestFirst(rows)}
              caption="London boroughs ranked by their dearest eligible pint price"
              highlight="dearest"
            />
          </section>
        ) : null}

        <BoroughCoverageStatus rows={seedBoroughCoverage} />

        {national.length > 0 ? (
          <section className="pintIndexSection" aria-labelledby="nationalHeading">
            <h2 id="nationalHeading" className="listingSectionTitle">Against the national figures</h2>
            <p className="listingSectionDek">
              None of these figures are ours. They are here so the prices on this
              page have something to sit against, and each one names who counted
              it, when, and exactly what they counted. A national cask ale is not
              a London pint.
            </p>
            <NationalPintBenchmarks rows={national} headingId="nationalHeading" />
          </section>
        ) : null}

        <section className="pintIndexSection" aria-labelledby="editionsHeading">
          <h2 id="editionsHeading" className="listingSectionTitle">Dated editions</h2>
          <p className="listingSectionDek">
            This page moves as prices land, which is no use to anyone quoting it.
            So every closed month also gets its own page, frozen the day it goes
            up. {pintIndexMonthLabel(openMonth)} closes on{" "}
            {formatPintIndexDate(pintIndexMonthCloseDay(openMonth))} and gets
            one next. Eligible prices dated before then can enter it.
          </p>
          <PintIndexEditions editions={editions} />
        </section>

        <section className="pintIndexSection" aria-labelledby="methodHeading">
          <h2 id="methodHeading" className="listingSectionTitle">Method and sources</h2>
          <div className="pintIndexProse">
            <p>Only prices with a public source and date are published. Older map-only prices stay out.</p>
            <p><strong>What counts.</strong> Community submissions, a pub or brewery&rsquo;s own published material, and properly licensed open data may enter the public Index only with a public source URL and price date.</p>
            <p><strong>Boroughs.</strong> We place coordinates inside versioned Greater London boundary shapes. A point outside every shape gets no borough. We never assign it to an arbitrary nearby one.</p>
            <p><strong>What stays out.</strong> The map may still use an older price baseline. Those rows stay out of this public Index, its CSV and its structured data.</p>
            <p><strong>Dates.</strong> Price dates come from the source record. We never present build time or file modification time as when a price was seen.</p>
          </div>
        </section>

        <p className="pintIndexFootnote">
          <Link href="/historic" className="listingLink">Explore cited historic pubs</Link>
        </p>
      </PintIndexScreen>
    </main>
  );
}
