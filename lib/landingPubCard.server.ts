import "server-only";

import history from "@/public/data/price_history/london.json";

import { isoDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import type { LandingArchiveIndex, LandingRailRow } from "@/lib/landingHero";
import {
  buildLandingAnchorRail,
  buildLandingArchiveIndex,
  buildLandingPubCard,
  type LandingPubCardData,
} from "@/lib/landingPubCard";
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
      const collectedOn = isoDate(PINT_DATASET_OBSERVED_AT);
      const card = buildLandingPubCard(venues, history, { collectedOn });
      const archive = buildLandingArchiveIndex(venues, history);
      const rail = card ? buildLandingAnchorRail(venues, card, archive) : [];
      const averages = pintPriceAverages(
        venues.flatMap((venue) =>
          typeof venue.cheapestPrice === "number" ? [venue.cheapestPrice] : [],
        ),
      );
      return { card, archive, rail, averages };
    })
    .catch(() => {
      // A failed read renders no card rather than an invented one, and the
      // next build gets a fresh attempt.
      cached = null;
      return { card: null, archive: {}, rail: [], averages: null };
    });
  return cached;
}
