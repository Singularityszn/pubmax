// The one listed pint a single pub's own page prints: its cheapest figure from
// the bundled price listing, the drink it is for, and who listed it on which
// day. A pure read over the venue the priced index already grouped, so a pub
// page shows exactly the figure the map pin, Tonight and the landing show.
//
// The publisher and the day come from `answerEvidenceFor` (lib/landingHero.ts),
// the ONE place they are read off a pub's price rows: the row's own named page
// and the day that row was read, never the dataset's collection day, and never
// a publisher inferred from anything else. A venue with no positive figure has
// no listed pint, and the page says so in words rather than inventing one.

import { answerEvidenceFor, type AnswerPublisher } from "@/lib/landingHero";
import type { LegacyPintPrice } from "@/lib/drinks";

export type VenueListedPint = {
  priceGbp: number;
  /** The drink the figure is for, or null when the row names none. */
  pintName: string | null;
  publisher: AnswerPublisher | null;
  /** `YYYY-MM-DD`, the London day the row was read, or null when it records none. */
  observedOn: string | null;
};

export function venueListedPint(
  venue: { cheapestPrice: number | null; cheapestPint: string; prices: readonly LegacyPintPrice[] },
): VenueListedPint | null {
  const priceGbp = venue.cheapestPrice;
  if (typeof priceGbp !== "number" || !Number.isFinite(priceGbp) || priceGbp <= 0) return null;
  const { publisher, observedOn } = answerEvidenceFor({ priceGbp, prices: venue.prices });
  return {
    priceGbp,
    pintName: venue.cheapestPint.trim() || null,
    publisher,
    observedOn,
  };
}
