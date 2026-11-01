import "server-only";

import history from "@/public/data/price_history/london.json";

import type { LandingArchiveIndex, LandingRailRow } from "@/lib/landingHero";
import {
  buildLandingAnchorRail,
  buildLandingArchiveIndex,
  buildLandingPubCard,
  type LandingPubCardData,
} from "@/lib/landingPubCard";
import { formatObservedDate } from "@/lib/dataFreshness";
import {
  buildLondonCollageAreaPrices,
  type LondonCollageAreaPrice,
} from "@/lib/landingLondonCollage";
import { pintFactStats } from "@/lib/pintFacts";
import { pintPriceAverages, type PintPriceAverages } from "@/lib/pintSavings";
import { listedPriceCohort, listedPriceCohortPrices } from "@/lib/pricedPubCount";
import { getPricedVenues } from "@/lib/venuePriceIndex";

/** What the landing hero ships: the anchor card, the archive index, the rail. */
export type LandingHeroData = {
  card: LandingPubCardData | null;
  archive: LandingArchiveIndex;
  rail: LandingRailRow[];
  /**
   * The city's two mean pint prices, taken over the very same read the card
   * came from, so the landing's saving line and its answer card can never
   * disagree about what the dataset holds. Null when the dataset is too small
   * to mean anything (lib/pintSavings.ts).
   */
  averages: PintPriceAverages | null;
  /**
   * When the prices behind that average were read, as one line ("The average
   * above comes from prices read between 4 July 2026 and 2 October 2026."),
   * from the same pubs. A line that
   * covers many prices names the oldest read as well as the newest, and it
   * counts the prices that record no read day rather than letting the range
   * stand for them (the borough fact block's rule, lib/pintFacts.ts). Null when
   * no price records a read. Site review, 18 Oct 2026: "Freshness is quiet."
   */
  priceReadLine: string | null;
  /**
   * The cheapest listed pint within a short walk of each photographed patch in
   * the founder collage, from this same read. An area with no priced pub nearby
   * is absent, so its tile prints no figure.
   */
  collagePrices: Record<string, LondonCollageAreaPrice>;
};

// The landing document is prerendered (app/page.tsx, force-static), so this
// runs at build and the answer cannot change between two requests. The
// history file is a static import, inlined by the bundler like the freshness
// registry in lib/dataFreshness.ts, so no route assembles a path at runtime
// and nothing needs tracing. Hold the promise, not the value, so concurrent
// first renders share one venue-index read.
let cached: Promise<LandingHeroData> | null = null;

export function loadLandingHeroData(): Promise<LandingHeroData> {
  cached ??= getPricedVenues()
    .then((venues) => {
      const card = buildLandingPubCard(venues, history);
      const archive = buildLandingArchiveIndex(venues, history);
      const rail = card ? buildLandingAnchorRail(venues, card, archive) : [];
      // The average names its base (lib/pricedPubCount.ts): pubs in our London
      // pub list with a listed cheapest pint, the same cohort /about reads.
      const cohort = listedPriceCohort(venues);
      const averages = pintPriceAverages(listedPriceCohortPrices(cohort));
      const priceReadLine = averages ? landingPriceReadLine(cohort) : null;
      const collagePrices = buildLondonCollageAreaPrices(venues);
      return { card, archive, rail, averages, priceReadLine, collagePrices };
    })
    .catch(() => {
      // A failed read renders no card rather than an invented one, and the
      // next build gets a fresh attempt.
      cached = null;
      return { card: null, archive: {}, rail: [], averages: null, priceReadLine: null, collagePrices: {} };
    });
  return cached;
}

/**
 * The read range of the pubs the landing average is taken over. Each pub's day
 * is the read of its own cheapest pint (`pintFactStats`), never the day the
 * list was rebuilt.
 */
export function landingPriceReadLine(
  venues: Parameters<typeof pintFactStats>[0],
): string | null {
  const stats = pintFactStats(venues, "London", "london");
  if (stats.pubCount === 0) return null;
  if (!stats.oldestObservedAt || !stats.newestObservedAt) return null;
  const oldest = formatObservedDate(new Date(stats.oldestObservedAt));
  const newest = formatObservedDate(new Date(stats.newestObservedAt));
  const range =
    oldest === newest
      ? `The average above comes from prices read on ${newest}.`
      : `The average above comes from prices read between ${oldest} and ${newest}.`;
  if (stats.undatedCount === 0) return range;
  // The borough fact block's own wording (lib/pintFacts.ts): the range dates
  // the prices that record a read, and the rest are counted, never hidden.
  const undated = stats.undatedCount.toLocaleString("en-GB");
  return `${range} ${undated} of its ${stats.pubCount.toLocaleString("en-GB")} pubs ${
    stats.undatedCount === 1 ? "records" : "record"
  } no read day.`;
}
