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
import { getPricedVenues } from "@/lib/venuePriceIndex";

// The landing document is prerendered (app/page.tsx, force-static), so this
// runs at build and the answer cannot change between two requests. The
// history file is a static import, inlined by the bundler like the freshness
// registry in lib/dataFreshness.ts, so no route assembles a path at runtime
// and nothing needs tracing. Hold the promise, not the value, so concurrent
// first renders share one venue-index read.
let cached: Promise<LandingPubCardData | null> | null = null;

export function loadLandingPubCard(): Promise<LandingPubCardData | null> {
  cached ??= getPricedVenues()
    .then((venues) =>
      buildLandingPubCard(venues, history, { collectedOn: isoDate(PINT_DATASET_OBSERVED_AT) }),
    )
    .catch(() => {
      // A failed read renders no card rather than an invented one, and the
      // next build gets a fresh attempt.
      cached = null;
      return null;
    });
  return cached;
}

/** What the hero prototype (issue #1357) ships beside the card. */
export type LandingHeroData = {
  card: LandingPubCardData | null;
  archive: LandingArchiveIndex;
  rail: LandingRailRow[];
};

let heroCached: Promise<LandingHeroData> | null = null;

export function loadLandingHeroData(): Promise<LandingHeroData> {
  heroCached ??= getPricedVenues()
    .then((venues) => {
      const card = buildLandingPubCard(venues, history, {
        collectedOn: isoDate(PINT_DATASET_OBSERVED_AT),
      });
      const archive = buildLandingArchiveIndex(venues, history);
      const rail = card ? buildLandingAnchorRail(venues, card, archive) : [];
      return { card, archive, rail };
    })
    .catch(() => {
      heroCached = null;
      return { card: null, archive: {}, rail: [] };
    });
  return heroCached;
}
