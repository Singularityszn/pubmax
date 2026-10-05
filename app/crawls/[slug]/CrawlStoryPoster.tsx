import type { Route } from "next";
import Link from "next/link";

import CrawlStoryCopyButton from "@/components/crawl/CrawlStoryCopyButton";
import CrawlStoryOwnerControls from "@/components/crawl/CrawlStoryOwnerControls";
import ShareBar from "@/components/share/ShareBar";
import Screen from "@/components/ui/screen";
import { computeChaosScore } from "@/lib/chaosScore";
import type { DurableStory } from "@/lib/crawlStoryStore";
import { formatGbp } from "@/lib/formatGbp";
import { buildCrawlShareText } from "@/lib/shareArtifacts";

// The durable Crawl Story poster, with the story already loaded. The page
// (page.tsx) reads the store and hands the record here; this component knows
// nothing about the store, so the audit can render it with a fixture story.
//
// Head: docs/design/LAUNCH_SCREENS.md. The kicker names the surface and, where
// the story has one, its author; the heading is the story's own name; the one
// primary starts the crawl on the map and the quiet way onward is the map.

// Plan the crawl back onto the map from its stop venue ids, the same share-URL
// shape seedCrawlState reads (mode=build&pubs=id1,id2). Stops missing a venue
// id just are not planned back.
function crawlMapHref(story: DurableStory): Route {
  const ids = story.stops.map((stop) => stop.venueId).filter(Boolean);
  if (ids.length === 0) return "/map";
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", ids.join(","));
  return `/map?${params.toString()}`;
}

// Chaos Score (issue #30, PRD "The Spill" § The Lock-In): optional, playful,
// computed from signals this durable story already carries: stop count, price
// spread across priced stops, and the story's own vibe tags. A durable story
// has no per-stop timestamp or borough field yet, so lateness and borough hops
// stay at their "no signal" default (0) here rather than guessing.
function chaosScoreFor(story: DurableStory) {
  const prices = story.stops.map((stop) => stop.priceGbp ?? null);
  return computeChaosScore({
    stopCount: story.stops.length,
    prices,
    vibeTags: story.vibeTags,
  });
}

// Build a /api/chaos-card URL carrying the already-computed score, grade and
// line so the OG image never has to recompute (and can never drift from what
// is shown on the page).
function chaosCardHref(story: DurableStory, chaos: ReturnType<typeof computeChaosScore>): Route {
  const params = new URLSearchParams();
  params.set("title", story.title);
  params.set("score", String(chaos.score));
  params.set("grade", chaos.grade);
  params.set("line", chaos.oneLiner);
  return `/api/chaos-card?${params.toString()}`;
}

export default function CrawlStoryPoster({ story, slug }: { story: DurableStory; slug: string }) {
  const total = story.totalGbp;
  const pricedStops = story.stops.filter((stop) => typeof stop.priceGbp === "number").length;
  const stopCount = story.stops.length;

  // Share lockup: a nostalgic one-liner so the crawl travels into a group chat.
  const shareText = buildCrawlShareText({
    title: story.title,
    stopCount,
    totalGbp: total,
  });

  // Chaos Score + meme export (issue #30): computed once here so the on-page
  // badge and the shared card always agree.
  const chaos = chaosScoreFor(story);
  const chaosCard = chaosCardHref(story, chaos);

  return (
    <article className="storyPoster">
      <Screen
        as="section"
        className="storyHead"
        kicker={
          story.authorHandle ? (
            <>
              Crawl by{" "}
              <Link
                href={`/u/${encodeURIComponent(story.authorHandle)}`}
                className="storyAuthorLink"
              >
                @{story.authorHandle}
              </Link>
            </>
          ) : (
            "Crawl"
          )
        }
        title={story.title}
        titleId="storyHeading"
        lede={story.summary || undefined}
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
          <ul className="storyTags" aria-label="Crawl vibe tags">
            {story.vibeTags.map((tag) => (
              <li key={tag} className="storyTag">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}

        <ol className="storyStops">
          {story.stops.map((stop, index) => (
            <li key={`${stop.venueId}-${index}`} className="storyStop">
              <span className="storyStopNumber" aria-hidden="true">
                {index + 1}
              </span>
              <div className="storyStopBody">
                <a className="storyStopName" href={stop.venueMapUrl}>
                  {stop.venueName}
                </a>
                {stop.note ? <p className="storyStopNote">{stop.note}</p> : null}
              </div>
              <span className="storyStopPrice">
                {typeof stop.priceGbp === "number" ? formatGbp(stop.priceGbp) : "–"}
              </span>
            </li>
          ))}
        </ol>

        <div className="storyReceipt" role="group" aria-label="Crawl total">
          <span>
            Round total
            <small>
              {pricedStops} of {stopCount} stop{stopCount === 1 ? "" : "s"} priced
            </small>
          </span>
          <strong>{formatGbp(total)}</strong>
        </div>

        {/* Chaos Score (issue #30): optional and playful; a crawl with zero
            stops (should not happen, but never trust it) just shows "Quiet". */}
        <div className="storyChaos" role="group" aria-label="Chaos Score">
          <span className="storyChaosScore">
            {chaos.score}
            <small>/100</small>
          </span>
          <span className="storyChaosBody">
            <strong className="storyChaosGrade">{chaos.grade}</strong>
            <span className="storyChaosLine">{chaos.oneLiner}</span>
          </span>
        </div>

        <div className="storyActions">
          {/* Meme export (issue #30): a branded OG-style card of the score,
              opened in a new tab so it can be saved or shared directly. */}
          <a
            href={chaosCard}
            className="storySecondaryBtn"
            target="_blank"
            rel="noreferrer"
          >
            Share the chaos
          </a>
          <CrawlStoryCopyButton />
        </div>

        {/* Author-only edit and delete (story 35). Renders nothing for non-authors. */}
        {story.authorHandle ? (
          <CrawlStoryOwnerControls slug={slug} authorHandle={story.authorHandle} />
        ) : null}

        {/* Share strip: the crawl spreads across X, WhatsApp, and group chats. */}
        <div className="storyShare">
          <ShareBar url={`/crawls/${slug}`} title={story.title} text={shareText} />
        </div>

        <p className="storyFootnote">Pubs, prices and the route between them.</p>
      </Screen>
    </article>
  );
}
