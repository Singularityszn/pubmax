import "server-only";

// Tonight's "From the pubs tonight" rows, read when the page is prepared
// (app/tonight/page.tsx), so they cost the reader no request.
//
// Only a PUBLISHED event or offer dated for this London service day, at a
// London pub the map can name: a fact whose pub cannot be named is left off,
// because an id is never a name. A store that cannot answer is no block, never
// a broken one. Nothing here ranks, colours or orders anything else on the page.

import { isNationalBaseVenueId, venueIdMatchesCity } from "@/lib/cityVenueIds";
import {
  operatorServiceDay,
  toPublicOperatorFact,
  tonightOperatorFacts,
  type TonightOperatorFact,
} from "@/lib/operatorFacts";
import { operatorFactsStore } from "@/lib/operatorFactsStore";
import { resolveVenue } from "@/lib/venueIndex";

export async function loadTonightOperatorFacts(now: number): Promise<TonightOperatorFact[]> {
  try {
    const read = await operatorFactsStore().listPublishedForDay(operatorServiceDay(now));
    const named = await Promise.all(
      tonightOperatorFacts(read.facts, now).map(async (fact): Promise<TonightOperatorFact | null> => {
        const venue = await resolveVenue(fact.venueId);
        if (!venue || venue.retired) return null;
        if (isNationalBaseVenueId(venue.id) || !venueIdMatchesCity(venue.id, "london")) return null;
        return { ...toPublicOperatorFact(fact), venueId: venue.id, venueName: venue.name };
      }),
    );
    return named.filter((fact): fact is TonightOperatorFact => fact !== null);
  } catch {
    return [];
  }
}
