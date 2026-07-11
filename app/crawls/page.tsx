"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Copy, MapPin, Flag } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";

import { decodeCrawlStory, totalGbp, type CrawlStory } from "@/lib/crawlStory";
import { curatedCrawlMapHref, curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import { landmarks } from "@/lib/landmarks";
import { bandById } from "@/lib/storyBands";
import {
  getRoutePack,
  routePackMapHref,
  routePackPrimaryCrawl,
  routePacks,
} from "@/lib/routePacks";
import { loadSlimVenues, type SlimVenue } from "@/lib/venuesSlim";
import SiteNav from "@/components/nav/SiteNav";
import RoundStarter from "@/components/round/RoundStarter";
import RouteThumbnail from "./RouteThumbnail";
import {
  buildCrawlRouteSummary,
  crawlPriceRange,
  formatCrawlRouteSummary,
  formatPriceRange,
} from "./routeSummary";
import "./crawls.css";

// The landmark a crawl starts at (story 27) — "starts at Big Ben"-style chip.
// Undefined when the crawl carries no startLandmarkId, or it points at an id
// that isn't a real landmark (defensive: never crash the crawls page over a
// stale reference).
function startLandmarkName(crawl: CuratedCrawl): string | undefined {
  if (!crawl.startLandmarkId) return undefined;
  return landmarks.find((lm) => lm.id === crawl.startLandmarkId)?.name;
}

function formatGbp(value: number): string {
  return `£${value.toFixed(2)}`;
}

// Turn a camelCase CrawlStyle ("writerTrail") into a human badge label
// ("Writer Trail"). Single-word styles ("heritage") just get capitalised.
function styleLabel(style: string): string {
  return style
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

// Reproduce a crawl on the map from a story's stop ids, matching the existing
// share-URL format read by seedCrawlState (mode=build&pubs=id1,id2). Stops that
// carry no venueId (e.g. a hand-authored story) just aren't planned back.
function planCrawlHref(story: CrawlStory): string {
  const ids = story.stops.map((stop) => stop.venueId).filter(Boolean);
  if (ids.length === 0) return "/map";
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", ids.join(","));
  return `/map?${params.toString()}`;
}

function CrawlsPageInner() {
  // useSearchParams so client navigations between ?pack= links re-filter the
  // curated grid (a mount-only window.location read would stick on the first pack).
  const searchParams = useSearchParams();
  const activePackId = searchParams.get("pack");
  const activePack = activePackId ? getRoutePack(activePackId) : undefined;
  const activePackCrawlIds = activePack ? new Set(activePack.crawlIds) : null;
  const visibleCrawls = activePackCrawlIds
    ? curatedCrawls.filter((crawl) => activePackCrawlIds.has(crawl.id))
    : curatedCrawls;

  // Read ?s= from the live search params so client navigations stay in sync.
  // decode never throws, so a garbage param falls through to the empty state.
  const story = useMemo<CrawlStory | null>(
    () => decodeCrawlStory(searchParams.get("s")),
    [searchParams],
  );

  // Slim venue index — the only client-safe source of stop coords + price, used
  // to derive HONEST route metrics for the curated cards (E4). Loaded once on
  // mount (same pattern as the Round route list); until it lands slimById is
  // empty and the cards simply render without metrics rather than guessing.
  const [slimVenues, setSlimVenues] = useState<SlimVenue[]>([]);
  useEffect(() => {
    let active = true;
    void loadSlimVenues().then((venues) => {
      if (active) setSlimVenues(venues);
    });
    return () => {
      active = false;
    };
  }, []);
  const slimById = useMemo(
    () => new Map(slimVenues.map((v) => [v.id, v])),
    [slimVenues],
  );

  const [copied, setCopied] = useState(false);
  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (permissions / insecure origin) — no-op, no crash.
    }
  }

  return (
    <main className="crawlsShell">
      <SiteNav active="crawls" />

      {story ? (
        <CrawlPoster story={story} copied={copied} onCopy={copyShareLink} />
      ) : (
        <section className="crawlEmpty" aria-labelledby="crawlsHeading">
          <p className="crawlEyebrow">Crawls worth walking</p>
          <h1 id="crawlsHeading">Every pint has a story.</h1>
          <p className="crawlEmptyBody">
            A Crawl Story is a shareable poster of a London pub crawl — the stops, the prices,
            the vibe. Here are a few routes worth the walk, handed down from the old hands who
            drank them first. Pick one, or start your own on the map.
          </p>

          <div className="routePacks" aria-labelledby="routePacksHeading">
            <p className="crawlEyebrow" id="routePacksHeading">
              Route packs
            </p>
            <ul className="routePackList">
              {routePacks.map((pack) => {
                const primary = routePackPrimaryCrawl(pack);
                const mapHref = routePackMapHref(pack);
                const browseHref = `/crawls?pack=${encodeURIComponent(pack.id)}`;
                const isBrowsing = activePackId === pack.id;
                const n = pack.crawlIds.length;
                const ariaLabel = primary
                  ? `Plan ${pack.title} on the map — ${primary.name}`
                  : `Plan ${pack.title} on the map`;
                return (
                  <li key={pack.id}>
                    <div className={isBrowsing ? "routePackCard isActive" : "routePackCard"}>
                      <Link
                        href={mapHref}
                        className="routePackLink"
                        aria-label={ariaLabel}
                      >
                        <span className="routePackTitle">{pack.title}</span>
                        <span className="routePackBlurb">{pack.blurb}</span>
                        <span className="routePackMeta">Open on map →</span>
                      </Link>
                      {n > 1 ? (
                        <Link
                          href={browseHref}
                          className="routePackBrowse"
                          aria-current={isBrowsing ? "true" : undefined}
                        >
                          Browse {n} routes
                        </Link>
                      ) : null}
                    </div>
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
          </div>

          <ul className="curatedGrid" aria-label="Curated crawls worth walking">
            {visibleCrawls.map((crawl) => {
              const originName = startLandmarkName(crawl);
              const placeStory = crawl.placeStoryBandId
                ? bandById(crawl.placeStoryBandId)
                : undefined;
              // HONEST route metrics from the slim index (E4). Undefined until
              // the index loads or when a crawl's stops don't resolve — the card
              // then shows only its existing stop-count line, never a fake shape,
              // walk time, or price.
              const routeSummary = buildCrawlRouteSummary(crawl.venueIds, slimById);
              const priceRange = crawlPriceRange(crawl.venueIds, slimById);
              return (
                <li key={crawl.id} id={crawl.id} className="curatedCard">
                  <span className="curatedBadge">{styleLabel(crawl.crawlStyle)}</span>
                  <h2 className="curatedName">{crawl.name}</h2>
                  <p className="curatedBlurb">{crawl.blurb}</p>
                  {routeSummary ? (
                    <div className="curatedRoute">
                      <RouteThumbnail
                        points={routeSummary.points}
                        className="curatedRouteThumb"
                      />
                      <span className="curatedRouteMeta">
                        {formatCrawlRouteSummary(routeSummary)}
                      </span>
                    </div>
                  ) : null}
                  {priceRange ? (
                    <span className="curatedPriceFrom">
                      Pints from {formatPriceRange(priceRange)}
                    </span>
                  ) : null}
                  {originName ? (
                    <span className="curatedOriginChip">
                      <Flag size={12} aria-hidden="true" /> Starts at {originName}
                    </span>
                  ) : null}
                  {placeStory ? (
                    <span className="curatedOriginChip curatedPlaceStoryChip">
                      Place story · {placeStory.title}
                    </span>
                  ) : null}
                  <p className="curatedMeta">
                    {crawl.venueIds.length} stop{crawl.venueIds.length === 1 ? "" : "s"}
                  </p>
                  <Link
                    href={curatedCrawlMapHref(crawl)}
                    className="curatedLink curatedPlanBtn"
                    aria-label={`Plan the ${crawl.name} crawl on the map`}
                  >
                    Plan this crawl →
                  </Link>
                </li>
              );
            })}
          </ul>

          <RoundStarter />

          <p className="crawlEmptyBody crawlOwnLead">
            Or build your own — pick the pubs, pass the round on.
          </p>
          <Link href="/map" className="crawlPrimaryBtn">
            <MapPin size={16} aria-hidden="true" /> Build your own crawl on the map
          </Link>
        </section>
      )}
    </main>
  );
}

function CrawlPoster({
  story,
  copied,
  onCopy,
}: {
  story: CrawlStory;
  copied: boolean;
  onCopy: () => void;
}) {
  const total = totalGbp(story);
  const pricedStops = story.stops.filter((stop) => typeof stop.priceGbp === "number").length;

  return (
    <article className="crawlPoster">
      <header className="crawlPosterHead">
        <p className="crawlEyebrow">A London crawl</p>
        <h1>{story.title || "An untitled crawl"}</h1>
        {story.caption ? <p className="crawlCaption">{story.caption}</p> : null}
        {story.vibeTags.length ? (
          <ul className="crawlTags" aria-label="Crawl vibe tags">
            {story.vibeTags.map((tag) => (
              <li key={tag} className="crawlTag">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

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
              {typeof stop.priceGbp === "number" ? formatGbp(stop.priceGbp) : "—"}
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
        <Link href={planCrawlHref(story)} className="crawlPrimaryBtn">
          <MapPin size={16} aria-hidden="true" /> Plan this crawl
        </Link>
        <button type="button" className="crawlSecondaryBtn" onClick={onCopy}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {/* aria-live announces the "Copied!" confirmation to screen readers
              without needing a separate status region — the button's own
              accessible name updates and is polite (non-interrupting). */}
          <span aria-live="polite">{copied ? "Copied!" : "Copy share link"}</span>
        </button>
      </div>

      <p className="crawlFootnote">Every pint has a story.</p>
    </article>
  );
}

export default function CrawlsPage() {
  // Suspense boundary required by Next.js when a client page uses useSearchParams
  // during static prerender — without it, /crawls fails the production build.
  return (
    <Suspense fallback={<main className="crawlsShell" aria-busy="true" />}>
      <CrawlsPageInner />
    </Suspense>
  );
}
