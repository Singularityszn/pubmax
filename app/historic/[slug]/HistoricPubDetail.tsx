import type { Route } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import ShareBar from "@/components/share/ShareBar";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import { slugifyBorough } from "@/lib/boroughs";
import type { HistoricPub } from "@/lib/historic";
import {
  citationLabel,
  heritageSourceLabel,
  historicRecord,
  listedBadge,
  venueStatusBadge,
} from "@/lib/historicFilter";
import { formatObservedDate } from "@/lib/dataFreshness";
import { LANDING_RECEIPT_LABEL, pintDropDoorHref } from "@/lib/landingHero";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { buildHistoricPubShareText } from "@/lib/shareArtifacts";
import type { VenueListedPint } from "@/lib/venueListedPint";
import { formatPrice } from "@/lib/venues";

// One notable pub's cited heritage story, with the record already loaded. The
// page (page.tsx) reads the dataset and hands the record here; this component
// knows nothing about the dataset, so the audit can render it with a fixture.
//
// Head: docs/design/LAUNCH_SCREENS.md. The kicker names the surface, the
// heading is the pub's own name, the lede is its own cited hook, the one
// primary opens the pub on the map and the quiet way onward plans a night
// from it. A pub the map cannot resolve gets the bare map and no plan door,
// because a link naming a pub the map would drop is a promise it cannot keep.

// The map's build mode with this pub as the first stop: the same share-URL
// shape the borough chapter and a landmark's "Start a crawl here" use.
function planNightHref(venueId: string): Route {
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", venueId);
  return `/map?${params.toString()}`;
}

// The day a listed row was read, in words. The row carries a London day.
function collectedDay(isoDay: string): string {
  const ms = Date.parse(`${isoDay}T12:00:00.000Z`);
  return Number.isFinite(ms) ? formatObservedDate(new Date(ms)) : isoDay;
}

// THE PRICE COMES FIRST AFTER THE NAME. The figure the app already lists for
// this pub (the map pin's figure), the drink it is for, and who listed it on
// which day, in the landing answer card's words. A pub we hold no price for
// says so and offers the way to log one; a pub the map cannot open gets the
// words alone, because a log door naming a pub the map would drop is a promise
// it cannot keep.
function HistoricListedPint({
  venueId,
  listedPint,
}: {
  venueId: string | null;
  listedPint: VenueListedPint | null;
}) {
  if (!listedPint) {
    return (
      <section className="hdPrice" aria-label="Pint price">
        <p className="hdPriceNone">
          No price logged here yet.
          {venueId ? (
            <>
              {" "}
              <Link prefetch={false} href={pintDropDoorHref(venueId)} className="hdPriceLog">
                {LANDING_RECEIPT_LABEL}
              </Link>
            </>
          ) : null}
        </p>
      </section>
    );
  }
  return (
    <section className="hdPrice" aria-label="Pint price">
      <p className="hdPriceFigure">
        <PriceBadge
          variant="current"
          band={priceBand(listedPint.priceGbp, venueId ? priceBandAreaForVenue(venueId) : undefined)}
        >
          {formatPrice(listedPint.priceGbp)}
        </PriceBadge>
        <span className="hdPricePint">{listedPint.pintName ?? "cheapest pint"}</span>
      </p>
      <p className="hdPriceSource">
        {listedPint.publisher ? (
          <>
            Listed by{" "}
            <a href={listedPint.publisher.url} target="_blank" rel="noopener noreferrer">
              {listedPint.publisher.label}
            </a>
          </>
        ) : (
          "Publisher not recorded"
        )}
        {listedPint.observedOn ? `, collected ${collectedDay(listedPint.observedOn)}` : ""}.
      </p>
    </section>
  );
}

export default function HistoricPubDetail({
  pub,
  listedPint,
}: {
  pub: HistoricPub;
  /**
   * The pint the app lists for this pub. Null when it holds none, so the page
   * says so; absent when the caller read no prices, so the page claims nothing.
   */
  listedPint?: VenueListedPint | null;
}) {
  // The date chip states what the date is OF, never a bare year: The Captain
  // Kidd's 1701 is the year the pirate it is named after was hanged, and a bare
  // 1701 reads as the year the pub opened (lib/heritageDate.mjs).
  const dateLabel = pub.dateLabel ?? pub.era;
  const grade = listedBadge(pub.listed);
  const status = venueStatusBadge(pub.venueStatus);
  const boroughSlug = pub.borough ? slugifyBorough(pub.borough) : null;
  const mapHref: Route | null = pub.venueId ? `/map?sel=${pub.venueId}` : null;
  const canonical = `/historic/${pub.slug}`;
  const shareText = buildHistoricPubShareText({ name: pub.name, hook: pub.hook });
  // The intro is the pub's own cited hook, so the record leaves it out and only
  // names its source, and a fact another fact already says is printed once.
  const record = historicRecord(pub);

  return (
    <>
      <p className="hdBack">
        <Link href="/historic" className="hdBackLink">
          &larr; All historic pubs
        </Link>
      </p>

      <Screen
        as="section"
        className="hdScreen"
        kicker="Historic pub"
        title={pub.name}
        titleId="hdHeading"
        lede={pub.hook || undefined}
        primary={
          mapHref ? (
            <Link prefetch={false} href={mapHref}>Open on the map</Link>
          ) : (
            <Link prefetch={false} href="/map">Open the map</Link>
          )
        }
        secondary={
          pub.venueId ? (
            <Link href={planNightHref(pub.venueId)}>Plan a night here</Link>
          ) : undefined
        }
      >
        {listedPint !== undefined ? (
          <HistoricListedPint venueId={pub.venueId} listedPint={listedPint} />
        ) : null}

        {dateLabel || grade || status || pub.borough ? (
          <div className="hdMeta">
            {dateLabel ? <span className="hdEra">{dateLabel}</span> : null}
            {grade ? <span className="hdGrade">{grade}</span> : null}
            {status ? <span className="hdGrade">{status}</span> : null}
            {pub.borough ? (
              <span className="hdBorough">
                {boroughSlug ? (
                  <Link href={`/borough/${boroughSlug}`} className="hdBoroughLink">
                    {pub.borough}
                  </Link>
                ) : (
                  pub.borough
                )}
              </span>
            ) : null}
          </div>
        ) : null}

        <section className="hdStory" aria-labelledby="hdStoryHeading">
          <h2 id="hdStoryHeading" className="hdStoryHeading">
            The record
          </h2>

          {record.introSource ? (
            <p className="hdIntroSource">
              {record.introSource.sourceRef ? (
                <span>The lead above is cited from</span>
              ) : (
                <span>The lead above is from {heritageSourceLabel(record.introSource.source)}.</span>
              )}
              {record.introSource.sourceRef ? (
                <a
                  className="hdCite"
                  href={record.introSource.sourceRef}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {citationLabel(record.introSource.sourceRef)}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : null}
            </p>
          ) : null}

          {record.facts.length === 0 ? (
            record.introSource ? null : (
              <EmptyState title="No fuller story on record.">
                Every claim here is cited, and we won&rsquo;t invent one to fill the
                gap.
              </EmptyState>
            )
          ) : (
            <ol className="hdFacts">
              {record.facts.map((fact, i) => (
                <li key={`${fact.source}-${i}`} className="hdFact">
                  <p className="hdFactText">{fact.fact}</p>
                  <div className="hdFactProvenance">
                    <span className="hdSource">{heritageSourceLabel(fact.source)}</span>
                    {fact.sourceRef ? (
                      <a
                        className="hdCite"
                        href={fact.sourceRef}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {citationLabel(fact.sourceRef)}
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="hdActions" aria-label="Explore this pub">
          {mapHref ? (
            <div className="hdActionRow">
              <Link prefetch={false} className="hdAction pressable" href={mapHref}>
                <PubPalMascot size={14} circular lazy />
                Ask your Pub Pal
              </Link>
            </div>
          ) : null}

          <ShareBar url={canonical} title={pub.name} text={shareText} />
        </section>

        <footer className="hdProvenance">
          Cited from Wikipedia and Wikidata. Never invented.
        </footer>
      </Screen>
    </>
  );
}
