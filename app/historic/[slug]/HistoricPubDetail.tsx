import type { Route } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import DataCreditsLink from "@/components/legal/DataCreditsLink";
import PlacePhoto from "@/components/listing/PlacePhoto";
import { pubPlacePhoto } from "@/components/listing/placePhoto";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import ShareBar from "@/components/share/ShareBar";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import { displayDrinkName } from "@/components/listing/displayCase";
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

// A cited sentence as a paragraph opens: Wikipedia leads and Wikidata
// descriptions are often stored lower case ("public house established in...",
// "historic public house on the banks..."), so the first letter is set as a
// capital for display. The stored text is untouched.
function sentenceStart(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
        <span className="hdPricePint">
          {listedPint.pintName ? displayDrinkName(listedPint.pintName) : "Cheapest pint"}
        </span>
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
  const lede = pub.hook ? sentenceStart(pub.hook) : undefined;
  // A photograph OF this pub, matched by venue id, or none. Never a picture of
  // its street or borough under its name (components/listing/placePhoto.ts).
  const photo = pubPlacePhoto(pub.venueId);

  return (
    <>
      <p className="hdBack listingSection">
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
        lede={lede}
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

        {photo ? (
          <PlacePhoto
            className="hdPhoto"
            photo={photo}
            sizes="(min-width: 720px) 40rem, calc(100vw - 2.75rem)"
          />
        ) : null}

        {/* THE EVIDENCE IS ONE SECTION UNDER ONE HEADING (taste plan, 18 Oct
            2026). The date, the grade, the borough, where the lead came from
            and every further cited fact were six small things of equal weight
            stacked under the price: three tinted chips, a coral caps label and
            a boxed citation each. Now the facts are a short list of terms and
            the citations are sentences. */}
        <section className="hdStory" aria-labelledby="hdStoryHeading">
          <h2 id="hdStoryHeading" className="listingSectionTitle">
            On record
          </h2>

          {dateLabel || grade || status || pub.borough ? (
            <dl className="hdMeta">
              {dateLabel ? (
                <div>
                  <dt>Date</dt>
                  <dd>{dateLabel}</dd>
                </div>
              ) : null}
              {grade ? (
                <div>
                  <dt>Listing</dt>
                  <dd>{grade}</dd>
                </div>
              ) : null}
              {status ? (
                <div>
                  <dt>Status</dt>
                  <dd>{status}</dd>
                </div>
              ) : null}
              {pub.borough ? (
                <div>
                  <dt>Borough</dt>
                  <dd>
                    {boroughSlug ? (
                      <Link href={`/borough/${boroughSlug}`} className="hdBoroughLink">
                        {pub.borough}
                      </Link>
                    ) : (
                      pub.borough
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {record.introSource ? (
            <p className="hdIntroSource">
              {record.introSource.sourceRef ? (
                <>
                  The lead above is cited from{" "}
                  <a
                    className="hdCite"
                    href={record.introSource.sourceRef}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {citationLabel(record.introSource.sourceRef)}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                  .
                </>
              ) : (
                <>The lead above is from {heritageSourceLabel(record.introSource.source)}.</>
              )}
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
                  <p className="hdFactText">{sentenceStart(fact.fact)}</p>
                  <p className="hdFactProvenance">
                    {fact.sourceRef ? (
                      <>
                        Cited from{" "}
                        <a
                          className="hdCite"
                          href={fact.sourceRef}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {citationLabel(fact.sourceRef)}
                          <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      </>
                    ) : (
                      <>From {heritageSourceLabel(fact.source)}</>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="hdActions" aria-label="Explore this pub">
          {mapHref ? (
            <div className="hdActionRow">
              <Link prefetch={false} className="hdAction" href={mapHref}>
                <PubPalMascot size={14} circular lazy />
                Ask your Pub Pal
              </Link>
            </div>
          ) : null}

          <ShareBar url={canonical} title={pub.name} text={shareText} />
        </section>

        <footer className="hdProvenance">
          Cited from Wikipedia and Wikidata. Never invented.{" "}
          <DataCreditsLink className="historicCreditsLink" />
        </footer>
      </Screen>
    </>
  );
}
