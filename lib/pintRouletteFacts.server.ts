import "server-only";

import { getListedBuilding } from "@/lib/heritageListings";
import { loadHistoricPubs, type HistoricPub } from "@/lib/historic";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import type { PintRouletteFact } from "@/lib/pintRoulette";
import type { Venue } from "@/lib/venues";

// The stored facts the roulette card may say about a pub, read once at build
// for the prerendered /near document (lib/pintRoulette.ts owns the line).
//
// TWO SOURCES AND NOTHING ELSE. The Historic England grade from the committed
// listed-building match, keyed by the same venue id the app links by, and the
// dated label of the cited historic index, only where that date is evidence of
// the pub's age (`era` is set). A pub with neither is left out, and its card
// prints no line. Only priced pubs are kept, because only a priced pub can
// come up.

/** The dated label a historic record may lend the card, or null. */
export function historicAgeLabel(pub: Pick<HistoricPub, "era" | "dateLabel" | "sourced">): string | null {
  if (pub.sourced !== true || !pub.era) return null;
  const label = typeof pub.dateLabel === "string" ? pub.dateLabel.trim() : "";
  return label || null;
}

export async function pintRouletteFacts(
  venues: readonly Pick<Venue, "id" | "cheapestPrice">[],
  historic: readonly HistoricPub[],
  gradeFor: (venueId: string) => Promise<string | null>,
): Promise<PintRouletteFact[]> {
  const ages = new Map<string, string>();
  for (const pub of historic) {
    const label = pub.venueId ? historicAgeLabel(pub) : null;
    if (pub.venueId && label && !ages.has(pub.venueId)) ages.set(pub.venueId, label);
  }
  const facts: PintRouletteFact[] = [];
  for (const venue of venues) {
    if (typeof venue.cheapestPrice !== "number" || !(venue.cheapestPrice > 0)) continue;
    const grade = await gradeFor(venue.id);
    const age = ages.get(venue.id) ?? null;
    if (grade || age) facts.push([venue.id, grade, age]);
  }
  return facts;
}

/** Degrades to no facts, so a failed read prints no line rather than a guess. */
export async function loadPintRouletteFacts(): Promise<PintRouletteFact[]> {
  try {
    const [venues, historic] = await Promise.all([loadPintPriceLandingVenues(), loadHistoricPubs()]);
    return await pintRouletteFacts(venues, historic, async (venueId) => {
      const listing = await getListedBuilding(venueId);
      return listing?.grade ?? null;
    });
  } catch {
    return [];
  }
}
