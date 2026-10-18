import "server-only";

import history from "@/public/data/price_history/london.json";

import type { LandingArchiveIndex, LandingRailRow } from "@/lib/landingHero";
import {
  buildLandingAnchorRail,
  buildLandingArchiveIndex,
  buildLandingPubCard,
  type LandingPubCardData,
} from "@/lib/landingPubCard";
import {
  buildLondonCollageAreaPrices,
  type LondonCollageAreaPrice,
} from "@/lib/landingLondonCollage";
import { pintPriceAverages, type PintPriceAverages } from "@/lib/pintSavings";
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
      const averages = pintPriceAverages(
        venues.flatMap((venue) =>
          typeof venue.cheapestPrice === "number" ? [venue.cheapestPrice] : [],
        ),
      );
      const collagePrices = buildLondonCollageAreaPrices(venues);
      return { card, archive, rail, averages, collagePrices };
    })
    .catch(() => {
      // A failed read renders no card rather than an invented one, and the
      // next build gets a fresh attempt.
      cached = null;
      return { card: null, archive: {}, rail: [], averages: null, collagePrices: {} };
    });
  return cached;
}
