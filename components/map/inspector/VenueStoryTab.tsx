import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { PintPriceBadge } from "@/components/PriceBadge";
import { useStaggeredRead } from "@/lib/useStaggeredRead";

import { ClaimBadge } from "@/components/map/venueInspectorBits";
import { discardBody } from "@/lib/responseBody";
import { formatPrice, type Venue } from "@/lib/venues";
import { buildVenueClaims } from "@/lib/curation";
import { heritageSourceLabel } from "@/lib/historicFilter";
import DataCreditsLink from "@/components/legal/DataCreditsLink";
import { heritageReadLabel, sanitizeHeritageFacts, type HeritageFact } from "@/lib/heritageFacts";
import { presentableDescription } from "@/lib/slopFilter";
import { heritageFactNamesAYear } from "@/lib/crawlBingo";
import { noteCrawlBingoAction } from "@/lib/crawlBingoNightLog";
import type { DropWithPhotos } from "@/components/map/usePintDrops";
import { bandsForVenue, type StoryBand } from "@/lib/storyBands";
import { nearestLandmarks, type Landmark } from "@/lib/landmarks";
import { curatedCrawlsForBand, placeStoryMapHref, type CuratedCrawl } from "@/lib/curatedCrawls";
import type { CityId } from "@/lib/cities";
import type { TabKey } from "@/lib/venueInspectorTabs";
import VisitReportPanel from "@/components/visits/VisitReportPanel";
import {
  isPubVenueKind,
  venueKindNoun,
} from "@/lib/venueKindFilters";

export default function VenueStoryTab({
  venue,
  tab,
  drops,
  cityId,
  cityLandmarks,
  cityStoryBands,
  cityCuratedCrawls,
  revealRecord = false,
  revealRecordLate = false,
  ask = null,
}: {
  venue: Venue;
  tab: TabKey;
  drops: DropWithPhotos[];
  cityId: CityId;
  cityLandmarks: Landmark[];
  cityStoryBands: StoryBand[];
  cityCuratedCrawls?: CuratedCrawl[];
  revealRecord?: boolean;
  revealRecordLate?: boolean;
  /** The Ask section: a question about the pub sits with its history. */
  ask?: React.ReactNode;
}) {
  // The distinct, provenance-stamped claim list for the inspected venue.
  // Editorial Sourced claims and contributor/anecdote drops stay separate.
  const claims = useMemo(() => buildVenueClaims(venue.curation, drops), [venue.curation, drops]);
  const venueNoun = venueKindNoun(venue.kind);

  // The scraped `description` is third-party AI marketing slop for the large
  // majority of venues ("Welcome to the X pub!", "vibrant atmosphere"). Guard
  // the render seam: slop resolves to null so the honest empty state below takes
  // over, and only genuine notes ever reach the page. Never edits the data.
  const description = useMemo(() => presentableDescription(venue.description), [venue.description]);

  // Place stories (Wave D): which curated corridors pass through this venue,
  // plus nearby landmark names for the Lore "Around here" section.
  const placeStories = useMemo(
    () => bandsForVenue(venue, cityStoryBands, cityLandmarks),
    [venue, cityStoryBands, cityLandmarks],
  );
  const aroundHere = useMemo(
    () => nearestLandmarks([venue.longitude, venue.latitude], 3, 0.75, cityLandmarks),
    [venue.latitude, venue.longitude, cityLandmarks],
  );

  // Passive cited heritage (H1): the facts this venue carries "on record", read
  // straight off GET /api/heritage so the story reads without interrogating the
  // Landlord. Server-payload only — every fact is validated + de-duped through
  // the pure sanitiser; nothing here is ever invented. Fail-soft on any error
  // (never throws, never blocks the tab), and an AbortController both cancels
  // the in-flight fetch and guards against a stale venue's facts on venue switch.
  const [heritageFacts, setHeritageFacts] = useState<HeritageFact[]>([]);
  // Which pub the held facts are ABOUT. Adopted during render, so the wait
  // before the next pub's read never shows the previous pub's facts.
  const [heritageFor, setHeritageFor] = useState(venue.id);
  if (heritageFor !== venue.id) {
    setHeritageFor(venue.id);
    setHeritageFacts([]);
  }
  const heritageReady = useStaggeredRead(3, venue.id);
  useEffect(() => {
    if (!heritageReady) return;
    const controller = new AbortController();
    // Reset first so the previous venue's facts never flash on the new one.
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setHeritageFacts([]);
    });
    (async () => {
      try {
        const res = await fetch(
          `/api/heritage?venueId=${encodeURIComponent(venue.id)}&venueName=${encodeURIComponent(
            venue.name,
          )}`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as { facts?: unknown };
        const facts = sanitizeHeritageFacts(body.facts);
        if (facts.length === 0) return;
        void Promise.resolve().then(() => {
          if (!controller.signal.aborted) setHeritageFacts(facts);
        });
      } catch {
        /* fail-soft: nothing on record */
      }
    })();
    return () => controller.abort();
  }, [heritageReady, venue.id, venue.name]);

  // Pub crawl bingo (lib/crawlBingo.ts): opening this tab reads the pub's
  // history card, and a dated fact on it is the oldest thing in the pub.
  useEffect(() => {
    if (tab !== "story") return;
    noteCrawlBingoAction("historyCard", venue.id);
    if (heritageFacts.some((fact) => heritageFactNamesAYear(fact.fact))) noteCrawlBingoAction("oldest", venue.id);
  }, [tab, venue.id, heritageFacts]);

  return (
    <div
      role="tabpanel"
      id="venuePanel-story"
      aria-labelledby="venueTab-story"
      className="venueTabPanel"
      hidden={tab !== "story"}
    >
      <VisitReportPanel
        venueId={venue.id}
        venueName={venue.name}
        active={tab === "story"}
      />

      {/* Passive cited heritage ("On record") — H1. Above the description so the
          facts a venue carries land the instant the tab opens. Every fact wears
          its source chip + citation; provenance-honest, server-payload only. */}
      {heritageFacts.length > 0 ? (
        <section className="heritageOnRecord" aria-labelledby="on-record-title">
          <div className="inspectorTitle">
            <BookOpen size={16} />
            <span id="on-record-title">On record</span>
          </div>
          <ul className="heritageFactList">
            {heritageFacts.map((fact, index) => (
              <li
                key={`${fact.source}-${index}`}
                className="heritageFact"
                data-source={fact.source}
              >
                <p className="heritageFactText">{fact.fact}</p>
                <div className="heritageFactMeta">
                  <span className="heritageSourceChip" data-source={fact.source}>
                    {heritageSourceLabel(fact.source)}
                  </span>
                  {heritageReadLabel(fact.observedAt) ? (
                    <span className="heritageFactRead">{heritageReadLabel(fact.observedAt)}</span>
                  ) : null}
                  {fact.sourceRef ? (
                    <a
                      className="heritageFactCite"
                      href={fact.sourceRef}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={fact.source === "nhle" ? () => noteCrawlBingoAction("listed", venue.id) : undefined}
                    >
                      Source
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="heritageCredits">
            <DataCreditsLink />
          </p>
        </section>
      ) : null}
      {description ? (
        <div
          className={revealRecord ? "venueRevealRecord" : undefined}
          data-reveal-delay={revealRecord && !revealRecordLate ? "3" : undefined}
        >
          <p className="description">{description}</p>
          {venue.storySourceUrl ? (
            <a
              className="heritageFactCite"
              href={venue.storySourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Story source
              <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
      ) : heritageFacts.length === 0 ? (
        <p className="description muted">
          {isPubVenueKind(venue.kind)
            ? // The Pint Drop door is on the Prices tab, not below this line, so
              // the sentence names the tab (launch UX micro-fix 6).
              `No heritage note for ${venue.name} yet. Know a story passed down about it? Open the Prices tab and log it with a Pint Drop.`
            : `No sourced story has been added for this ${venueNoun}.`}
        </p>
      ) : null}
      {claims.length > 0 ? (
        <div className="claimList">
          {claims.map((claim, index) => (
            <div key={`${claim.kind}-${index}`} className="claimCard">
              <div className="claimHead">
                <span className="claimEra">{claim.era ?? claim.label}</span>
                <ClaimBadge kind={claim.kind} />
              </div>
              <p>{claim.content}</p>
              {claim.sourceRef ? (
                <a href={claim.sourceRef} target="_blank" rel="noreferrer">
                  {claim.label}
                  <ExternalLink size={14} />
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {ask}

      {/* Place stories / Around here (Wave D) — user-facing copy uses
          "Place stories", never internal corridor jargon. */}
      <section className="placeStories" aria-labelledby="place-stories-title">
        <div className="inspectorTitle">
          <BookOpen size={16} />
          <span id="place-stories-title">Place stories</span>
        </div>
        <p className="placeStoriesLead">What should I know about this place?</p>
        {placeStories.length === 0 ? (
          <p className="description muted">
            No Place stories pass through {venue.name}{" "}yet. Open Place stories
            on the map, or ask the PUBMAXXER.
          </p>
        ) : (
          <div className="placeStoryList">
            {placeStories.map((band) => {
              const source = band.sources[0];
              const storyCrawls = curatedCrawlsForBand(band.id, cityCuratedCrawls);
              const primaryCrawl = storyCrawls[0];
              return (
                <article key={band.id} className="placeStoryCard">
                  <h4 className="placeStoryTitle">{band.title}</h4>
                  <p className="placeStoryCopy">{band.copy}</p>
                  <div className="placeStoryActions">
                    <Link
                      className="placeStoryWalk"
                      href={placeStoryMapHref(
                        band.id,
                        primaryCrawl?.id,
                        cityId,
                        cityCuratedCrawls,
                      )}
                    >
                      Walk this story
                    </Link>
                    {primaryCrawl ? (
                      <Link
                        className="placeStoryCrawl"
                        href={`/crawls#${encodeURIComponent(primaryCrawl.id)}`}
                      >
                        {primaryCrawl.name}
                      </Link>
                    ) : null}
                    {source ? (
                      <a
                        className="placeStorySource"
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.label}
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {aroundHere.length > 0 ? (
          <div className="aroundHere">
            <p className="aroundHereLabel">Around here</p>
            <ul className="aroundHereList">
              {aroundHere.map(({ landmark, km }) => (
                <li key={landmark.id}>
                  <span>{landmark.name}</span>
                  <small>{km < 0.1 ? "<100 m" : `${km.toFixed(1)} km`}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="priceList">
        {venue.prices.slice(0, 6).map((price) => (
          <div key={price.app_price_id}>
            <span>{price.pint_name}</span>
            {price.price_gbp === null ? (
              <span>{formatPrice(null)}</span>
            ) : (
              <PintPriceBadge priceGbp={price.price_gbp} venueId={venue.id} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
