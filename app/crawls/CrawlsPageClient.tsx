"use client";

import type { Route } from "next";
import { offlineOrMessage } from "@/lib/apiErrorMessage";

import Link from "next/link";
import { Check, Copy, MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { decodeCrawlStory, totalGbp, type CrawlStory } from "@/lib/crawlStory";
import { curatedCrawlMapHref, type CuratedCrawl } from "@/lib/curatedCrawls";
import { landmarks } from "@/lib/landmarks";
import { namedRoutePathForCrawl } from "@/lib/namedRoutes";
import { getRoutePack, routePacks } from "@/lib/routePacks";
import { formatGbp } from "@/lib/formatGbp";
import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { loadSlimVenuesForCityResult, type SlimVenue } from "@/lib/venuesSlim";
import SiteNav from "@/components/nav/SiteNav";
import RoundStarter from "@/components/round/RoundStarter";
import HostOnDate from "@/components/crawls/HostOnDate";
import type { CityCrawlGroup } from "@/lib/cityCrawlDirectory";
import { RowList, RowListItem } from "@/components/ui/row-list";
import Screen from "@/components/ui/screen";
import { plainDashes } from "@/components/listing/displayCase";
import PlacePhoto from "@/components/listing/PlacePhoto";
import type { PlacePhoto as PlacePhotoData } from "@/components/listing/placePhotoRules";
import {
  buildCrawlRouteSummary,
  crawlPriceRange,
  formatPriceRange,
  visibleCuratedCrawls,
  type CrawlPriceRange,
} from "./routeSummary";
import CrawlsYouCanJoin from "./CrawlsYouCanJoin";
import "@/components/listing/listing.css";
import "./crawls.css";

// The landmark a crawl starts at (story 27) — "starts at Big Ben"-style chip.
// Undefined when the crawl carries no startLandmarkId, or it points at an id
// that isn't a real landmark (defensive: never crash the crawls page over a
// stale reference).
function startLandmarkName(crawl: CuratedCrawl): string | undefined {
  if (!crawl.startLandmarkId) return undefined;
  return landmarks.find((lm) => lm.id === crawl.startLandmarkId)?.name;
}

// Turn a camelCase CrawlStyle ("writerTrail") into a human badge label
// ("Writer trail"). Single-word styles ("heritage") just get capitalised.
function styleLabel(style: string): string {
  return style
    .replace(/([a-z])([A-Z])/g, (_, lower: string, upper: string) => `${lower} ${upper.toLowerCase()}`)
    .replace(/^./, (char) => char.toUpperCase());
}

// The compact groups are keyed by style label. The heritage rail leads (the
// cohort review found the older, quiet-pint drinker under-served here) and reads
// in the page's calm voice rather than a bare machine label. Every other group
// keeps its plain style label; a head that isn't overridden falls through to it.
const HERITAGE_GROUP_LABEL = styleLabel("heritage");
const GROUP_HEAD: Record<string, string> = {
  [HERITAGE_GROUP_LABEL]: "Heritage routes, handed down",
};

function groupHead(label: string): string {
  return GROUP_HEAD[label] ?? label;
}

// Every crawl after the featured one, grouped by crawlStyle theme. The heritage
// rail leads; everything else keeps its first-seen order (stable). Nothing is
// dropped, every crawl stays reachable. Pure, so the component derives it in
// render and the React Compiler memoises what it sees fit.
function groupCompactCrawls(crawls: CuratedCrawl[]): [string, CuratedCrawl[]][] {
  const order: string[] = [];
  const byLabel = new Map<string, CuratedCrawl[]>();
  for (const crawl of crawls) {
    const label = styleLabel(crawl.crawlStyle);
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label)!.push(crawl);
  }
  const ordered = order
    .map((label, index) => ({ label, index }))
    .sort((a, b) => {
      const aHeritage = a.label === HERITAGE_GROUP_LABEL ? 0 : 1;
      const bHeritage = b.label === HERITAGE_GROUP_LABEL ? 0 : 1;
      return aHeritage - bHeritage || a.index - b.index;
    })
    .map((entry) => entry.label);
  return ordered.map((label) => [label, byLabel.get(label)!]);
}

// A fixed route's stops with their names, in the route's order, or null until
// every stop is in the slim index. A route is never hosted with a stop missing.
function curatedStops(
  crawl: CuratedCrawl,
  slimById: ReadonlyMap<string, SlimVenue>,
): { venueId: string; venueName: string }[] | null {
  const stops = crawl.venueIds.map((id) => ({ venueId: id, venueName: slimById.get(id)?.name ?? "" }));
  return stops.every((stop) => stop.venueName) ? stops : null;
}

// Reproduce a crawl on the map from a story's stop ids, matching the existing
// share-URL format read by seedCrawlState (mode=build&pubs=id1,id2). Stops that
// carry no venueId (e.g. a hand-authored story) just aren't planned back.
function crawlMapHref(story: CrawlStory): Route {
  const ids = story.stops.map((stop) => stop.venueId).filter(Boolean);
  if (ids.length === 0) return "/map";
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", ids.join(","));
  return `/map?${params.toString()}`;
}

export default function CrawlsPageClient({ pack, encodedStory, featuredPhoto = null, cityCrawlGroups = [] }: {
  cityCrawlGroups?: CityCrawlGroup[];
  pack?: string;
  encodedStory?: string | null;
  /**
   * The featured crawl's lead photograph, resolved on the server
   * (components/listing/placePhotoRules.ts): the patch every stop is a short walk
   * from, or null when no photograph we hold is honestly of its route.
   */
  featuredPhoto?: PlacePhotoData | null;
}) {
  // The server passes query values on each navigation. No Suspense placeholder
  // hides the directory from a reader whose JavaScript cannot run.
  const activePackId = pack;
  const activePack = activePackId ? getRoutePack(activePackId) : undefined;
  const visibleCrawls = visibleCuratedCrawls(activePackId);

  // The server supplies ?s= again on navigation. Invalid values fall through
  // to the directory because decodeCrawlStory never throws.
  const story = useMemo<CrawlStory | null>(
    () => decodeCrawlStory(encodedStory),
    [encodedStory],
  );

  // Slim venue index — the only client-safe source of stop coords + price, used
  // to derive HONEST route metrics for the curated cards (E4). Loaded once on
  // mount (same pattern as the Round route list); until it lands slimById is
  // empty and the cards simply render without metrics rather than guessing.
  const [slimVenues, setSlimVenues] = useState<SlimVenue[]>([]);
  const [venueIndexStatus, setVenueIndexStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    let active = true;
    void loadSlimVenuesForCityResult()
      .then(({ rows, status }) => {
        if (!active) return;
        setSlimVenues(rows);
        setVenueIndexStatus(status === "ready" ? "ready" : "error");
      })
      .catch(() => {
        if (active) setVenueIndexStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);
  const slimById = useMemo(
    () => new Map(slimVenues.map((v) => [v.id, v])),
    [slimVenues],
  );

  // ONE featured crawl up top (full card, route viz) + the rest as compact
  // scannable rows grouped by crawlStyle theme — the "wall of 15 identical
  // cards" from the mobile audit read as generated filler. Every crawl stays
  // reachable (featured + every group row), nothing is dropped, no repeated
  // full-card layout.
  const featuredCrawl = visibleCrawls[0];
  const compactGroups = groupCompactCrawls(visibleCrawls.slice(1));

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  async function copyShareLink() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }

  return (
    <main
      id="main"
      className="crawlsShell listingShell"
      aria-busy={venueIndexStatus === "loading"}
      data-venue-index-status={venueIndexStatus}
    >
      <SiteNav active="crawls" />

      {story ? (
        <CrawlPoster story={story} copied={copied} copyError={copyError} onCopy={copyShareLink} />
      ) : (
        // docs/design/LAUNCH_SCREENS.md: the one primary starts the featured
        // crawl on the map; the quiet way onward is the bare map, where the
        // reader builds their own. With nothing featured the primary falls
        // back to the map rather than promising a route the page cannot name.
        <Screen
          as="section"
          className="crawlEmpty"
          kicker="Crawls"
          title="London pub crawl routes"
          titleId="crawlsHeading"
          lede="Pub stories mapped into walks, each with its stops, prices and the walk between them. Pick one, or start your own on the map."
          primary={
            <Link
              prefetch={false}
              href={featuredCrawl ? curatedCrawlMapHref(featuredCrawl) : "/map"}
            >
              Start a crawl
            </Link>
          }
          secondary={
            <Link prefetch={false} href="/map">
              Open the map
            </Link>
          }
        >
          {/* One column, and from 1100px the featured crawl beside it as a
              sticky pane (crawls.css). The pane is a grid placement of the
              same element, so the reading and tab order stay the DOM's. */}
          <div className="crawlLayout">
            <CrawlsYouCanJoin />

            <nav className="routePackNav" aria-labelledby="routePacksHeading">
              <p className="crawlEyebrow" id="routePacksHeading">
                Jump to a route pack
              </p>
              <ul className="routePackChipRow">
                {routePacks.map((pack) => {
                  const browseHref: Route = `/crawls?pack=${encodeURIComponent(pack.id)}`;
                  const isBrowsing = activePackId === pack.id;
                  const n = pack.crawlIds.length;
                  return (
                    <li key={pack.id}>
                      <Link
                        href={browseHref}
                        className={isBrowsing ? "routePackChip isActive" : "routePackChip"}
                        aria-current={isBrowsing ? "true" : undefined}
                        title={pack.blurb}
                      >
                        {pack.title}
                        <span className="routePackChipCount">{n}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {activePack ? (
                <p className="routePackActiveNote">
                  Showing {activePack.title} routes.{" "}
                  <Link href="/crawls">Show all crawls</Link>
                </p>
              ) : null}
            </nav>

            {featuredCrawl ? (
              <FeaturedCrawlCard crawl={featuredCrawl} slimById={slimById} photo={featuredPhoto} priceStatus={venueIndexStatus} />
            ) : null}

            {compactGroups.length ? (
              <div className="crawlCompactGroups">
                {compactGroups.map(([groupLabel, crawlsInGroup]) => (
                  <section
                    key={groupLabel}
                    className="crawlCompactGroup"
                    aria-labelledby={`crawlGroup-${groupLabel.replace(/\s+/g, "-")}`}
                  >
                    <h3
                      id={`crawlGroup-${groupLabel.replace(/\s+/g, "-")}`}
                      className="crawlCompactGroupHeading"
                    >
                      {groupHead(groupLabel)}
                    </h3>
                    <RowList className="crawlCompactList" label={`${groupLabel} crawls`}>
                      {crawlsInGroup.map((crawl) => (
                        <CompactCrawlRow key={crawl.id} crawl={crawl} slimById={slimById} priceStatus={venueIndexStatus} />
                      ))}
                    </RowList>
                  </section>
                ))}
              </div>
            ) : null}

            <CityCrawlLinks groups={cityCrawlGroups} />

            <RoundStarter />

            <p className="crawlEmptyBody crawlOwnLead">
              Or build your own. Pick the pubs, pass the round on.
            </p>
            <Link prefetch={false} href="/map" className="crawlSecondaryBtn">
              <MapPin size={16} aria-hidden="true" /> Build your own crawl on the map
            </Link>
          </div>
        </Screen>
      )}
    </main>
  );
}

// Each endpoint retains its own pub, drink, serving and source day. The slim
// index drops the drink name of a comparable pint to stay small, so a missing
// drink or serving means "not in this index", never "not recorded": the line
// leaves it out rather than claim an absence. The compact row renders this
// evidence beside its navigation link, never inside it.
function CrawlPriceEvidence({ range, status }: {
  range: CrawlPriceRange | undefined;
  status: "loading" | "ready" | "error";
}) {
  if (!range) return status === "loading" ? null : (
    <p className="crawlPriceCoverage">
      {status === "error" ? "Price evidence unavailable." : "No comparable listed pint prices recorded for these stops."}
    </p>
  );
  const endpoints = range.minGbp === range.maxGbp ? [range.min] : [range.min, range.max];
  return (
    <div className="crawlPriceEvidence">
      <p className="crawlPriceCoverage">Listed pint prices for {range.pricedStops} of {range.totalStops} stops.</p>
      <ul className="crawlPriceEndpoints" aria-label="Price range endpoints">
        {endpoints.map((point) => (
          <li key={point.venueId}>
            <p className="crawlPriceEndpointSummary">
              <span className="curatedPriceRange">{formatGbp(point.priceGbp)}</span>
              {point.evidence.drinkLabel ? <>{" · "}{point.evidence.drinkLabel}</> : null}
              {point.evidence.servingSize ? <>{" · "}{point.evidence.servingSize}</> : null}
              {" at "}{point.venueName}.
            </p>
            <p className="crawlPriceSource">
              {point.evidence.publisher?.label || "Publisher not recorded"}. {point.evidence.observedOn
                ? `Source read ${formatObservedDate(new Date(point.evidence.observedOn))}`
                : "Source read date unknown"}.
            </p>
          </li>
        ))}
      </ul>
      {range.pricedStops < range.totalStops ? (
        <p className="crawlPriceCoverage">Other stops have no comparable listed pint price in this view.</p>
      ) : null}
    </div>
  );
}

// The featured crawl keeps its photograph, one-line introduction and quiet map
// link. Its price range now carries the endpoint evidence immediately below.
// A route with no honest photograph gets none, never a stand-in.
function FeaturedCrawlCard({
  crawl,
  slimById,
  photo,
  priceStatus,
}: {
  crawl: CuratedCrawl;
  slimById: ReadonlyMap<string, SlimVenue>;
  photo: PlacePhotoData | null;
  priceStatus: "loading" | "ready" | "error";
}) {
  const originName = startLandmarkName(crawl);
  const routePath = namedRoutePathForCrawl(crawl.id);
  const routeSummary = buildCrawlRouteSummary(crawl.venueIds, slimById);
  const priceRange = priceStatus === "ready" ? crawlPriceRange(crawl.venueIds, slimById) : undefined;
  const stops = crawl.venueIds.length;
  const hostStops = curatedStops(crawl, slimById);
  const meta = [
    `${stops} stop${stops === 1 ? "" : "s"}${originName ? ` from ${originName}` : ""}`,
    routeSummary ? `about ${routeSummary.totalMinutes} min (straight-line estimate)` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="curatedFeaturedWrap">
      <p className="crawlEyebrow curatedFeaturedEyebrow">Featured crawl</p>
      <article
        key={crawl.id}
        id={crawl.id}
        className={photo ? "curatedCard curatedFeaturedCard curatedCard--photo" : "curatedCard curatedFeaturedCard"}
      >
        {photo ? (
          <PlacePhoto
            className="curatedPhoto"
            photo={photo}
            sizes="(min-width: 1100px) 18rem, (min-width: 700px) 40rem, calc(100vw - 2.75rem)"
          />
        ) : null}
        <h2 className="curatedName">
          {routePath ? (
            <Link prefetch={false} href={routePath}>
              {crawl.name}
            </Link>
          ) : (
            crawl.name
          )}
        </h2>
        <p className="curatedBlurb">{plainDashes(crawl.blurb)}</p>
        <p className="curatedMeta">
          {meta}
          {priceRange ? (
            <>
              {". Listed pints "}
              <span className="curatedPriceRange">{formatPriceRange(priceRange)}</span>
            </>
          ) : null}
        </p>
        <CrawlPriceEvidence range={priceRange} status={priceStatus} />
        <Link
          prefetch={false}
          href={curatedCrawlMapHref(crawl)}
          className="curatedPlanBtn"
          aria-label={`Plan the ${crawl.name} crawl on the map`}
        >
          Plan this crawl
        </Link>
        {hostStops ? (
          <HostOnDate title={crawl.name} stops={hostStops} returnPath={`/crawls#${crawl.id}`} />
        ) : null}
      </article>
    </div>
  );
}

function CompactCrawlRow({
  crawl,
  slimById,
  priceStatus,
}: {
  crawl: CuratedCrawl;
  slimById: ReadonlyMap<string, SlimVenue>;
  priceStatus: "loading" | "ready" | "error";
}) {
  const originName = startLandmarkName(crawl);
  const priceRange = priceStatus === "ready" ? crawlPriceRange(crawl.venueIds, slimById) : undefined;
  const stopCount = crawl.venueIds.length;
  const hostStops = curatedStops(crawl, slimById);

  return (
    <li className="crawlCompactRow" id={crawl.id}>
      <Link
        prefetch={false}
        href={curatedCrawlMapHref(crawl)}
        className="crawlCompactLink"
        aria-label={`Plan the ${crawl.name} crawl on the map`}
      >
        <span className="rowListBody">
          <span className="rowListTitle crawlCompactName">{crawl.name}</span>
          <span className="rowListMeta crawlCompactMetaRow">
            {originName ? <span className="crawlCompactArea">{originName}</span> : null}
            <span className="crawlCompactStops">
              {stopCount} stop{stopCount === 1 ? "" : "s"}
            </span>
          </span>
        </span>
        {priceRange ? (
          <span className="rowListTrailing crawlCompactPrice">{formatPriceRange(priceRange)}</span>
        ) : null}
      </Link>
      <CrawlPriceEvidence range={priceRange} status={priceStatus} />
      {hostStops ? (
        <HostOnDate title={crawl.name} stops={hostStops} returnPath={`/crawls#${crawl.id}`} compact />
      ) : null}
    </li>
  );
}

function CrawlPoster({
  story,
  copied,
  copyError,
  onCopy,
}: {
  story: CrawlStory;
  copied: boolean;
  copyError: string;
  onCopy: () => void;
}) {
  const total = totalGbp(story);
  const pricedStops = story.stops.filter((stop) => typeof stop.priceGbp === "number").length;

  // The same head the durable poster (/crawls/[slug]) wears: the kicker names
  // the surface, the heading is the story's own name, the one primary starts
  // the crawl on the map and the quiet way onward is the bare map.
  return (
    <article className="crawlPoster listingSection">
      <Screen
        as="section"
        className="crawlPosterHead"
        kicker="Crawl"
        title={story.title || "An untitled crawl"}
        titleId="crawlPosterHeading"
        lede={story.caption || undefined}
        primary={
          <Link prefetch={false} href={crawlMapHref(story)}>
            Start this crawl
          </Link>
        }
        secondary={
          <Link prefetch={false} href="/map">
            Open the map
          </Link>
        }
      >
        {story.vibeTags.length ? (
          <ul className="crawlTags" aria-label="Crawl vibe tags">
            {story.vibeTags.map((tag) => (
              <li key={tag} className="crawlTag">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}

        <ol className="crawlStops">
          {story.stops.map((stop, index) => (
            <li key={`${stop.venueId || stop.name}-${index}`} className="crawlStop">
              <span className="crawlStopNumber" aria-hidden="true">
                {index + 1}
              </span>
              <div className="crawlStopBody">
                <strong>{stop.name}</strong>
                {stop.note ? <p className="crawlStopNote">{stop.note}</p> : null}
              </div>
              <span className="crawlStopPrice">
                {typeof stop.priceGbp === "number" ? formatGbp(stop.priceGbp) : "No price"}
              </span>
            </li>
          ))}
        </ol>

        <div className="crawlReceipt" role="group" aria-label="Crawl total">
          <span>
            Round total
            <small>
              {pricedStops} of {story.stops.length} stop{story.stops.length === 1 ? "" : "s"} priced
            </small>
          </span>
          <strong>{formatGbp(total)}</strong>
        </div>

        <div className="crawlActions">
          <button type="button" className="crawlSecondaryBtn" onClick={onCopy}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {/* aria-live announces the "Copied" confirmation to screen readers
                without needing a separate status region — the button's own
                accessible name updates and is polite (non-interrupting). */}
            <span aria-live="polite">{copied ? "Copied" : "Copy share link"}</span>
          </button>
          {copyError ? <p role="status">{copyError}</p> : null}
        </div>

        <HostOnDate
          title={story.title || "A pub crawl"}
          stops={story.stops.map((stop) => ({ venueId: stop.venueId, venueName: stop.name }))}
          returnPath="/crawls"
        />

        <p className="crawlFootnote">Pubs, prices and the route between them.</p>
      </Screen>
    </article>
  );
}

/** Other enabled cities' complete routes, after the London directory. */
export function CityCrawlLinks({ groups }: { groups: readonly CityCrawlGroup[] }) {
  if (groups.length === 0) return null;
  const firstNote = groups[0]!.priceNote;
  const sharedNote = firstNote !== null && groups.every((group) => group.priceNote === firstNote)
    ? firstNote : null;
  return (
    <section className="crawlOtherCities" aria-labelledby="otherCityCrawlsHeading">
      <div className="crawlOtherCitiesHead">
        <h2 id="otherCityCrawlsHeading" className="crawlOtherCitiesTitle">Crawls in other cities</h2>
        {sharedNote ? <p className="crawlOtherCitiesNote">{sharedNote}</p> : null}
      </div>
      {groups.map((group) => (
        <section key={group.cityId} className="crawlCompactGroup" aria-labelledby={`cityCrawls-${group.cityId}`}>
          <h3 id={`cityCrawls-${group.cityId}`} className="crawlCompactGroupHeading">{group.cityName}</h3>
          {group.priceNote && !sharedNote ? <p className="crawlOtherCitiesNote">{group.priceNote}</p> : null}
          <RowList label={`${group.cityName} crawls`}>
            {group.crawls.map((crawl) => (
              <RowListItem key={crawl.id} href={crawl.href} title={crawl.name} meta={`${crawl.stops} stops`} />
            ))}
          </RowList>
        </section>
      ))}
    </section>
  );
}
