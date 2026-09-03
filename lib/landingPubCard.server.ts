import "server-only";

import history from "@/public/data/price_history/london.json";

import { isoDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { buildLandingPubCard, type LandingPubCardData } from "@/lib/landingPubCard";
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
