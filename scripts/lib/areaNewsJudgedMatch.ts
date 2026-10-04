/**
 * Judged area-news venue match (requires TYPESAFE_API_KEY).
 *
 * Cheap gates stay in areaNewsMatch.mjs (borough + shared core tokens). The
 * same-pub Noul decides. Review-band and ambiguous merges never auto-match.
 */

import { collectAreaNewsCandidates, type AreaNewsVenue } from "./areaNewsMatch.mjs";
import {
  judgeSamePubPair,
  requiresTypesafeKeyMessage,
  snippetFromVenueGroup,
  typesafeConfigured,
} from "@/lib/samePubIdentity";
import type { SamePubReviewEntry } from "./samePubJudgedCanonicalize";

export type JudgedAreaNewsMatch = {
  venueId: string | null;
  confidence: "high" | "medium" | null;
  review: SamePubReviewEntry[];
};

function pairState(factName: string, boroughSlug: string, venue: AreaNewsVenue) {
  return {
    a: snippetFromVenueGroup({
      name: factName,
      address: boroughSlug,
      operator: null,
      website: null,
    }),
    b: snippetFromVenueGroup({
      name: venue.name,
      address: venue.borough,
      operator: null,
      website: null,
    }),
    distanceMetres: 0,
  };
}

export async function judgedMatchVenue(
  pubName: string,
  boroughSlug: string,
  venues: AreaNewsVenue[],
): Promise<JudgedAreaNewsMatch> {
  if (!typesafeConfigured()) {
    throw new Error(requiresTypesafeKeyMessage());
  }

  const { exact, subset } = collectAreaNewsCandidates(pubName, boroughSlug, venues);
  const ranked = [
    ...exact.map((venue) => ({ venue, confidence: "high" as const })),
    ...subset.map((venue) => ({ venue, confidence: "medium" as const })),
  ];
  const review: SamePubReviewEntry[] = [];
  const merged: Array<{ venue: AreaNewsVenue; confidence: "high" | "medium" }> = [];

  for (const row of ranked) {
    const judged = await judgeSamePubPair(pairState(pubName, boroughSlug, row.venue));
    if (!judged) {
      throw new Error(
        `A judged area-news pass could not reach TypeSafe for ${pubName} / ${row.venue.id}.`,
      );
    }
    if (judged.band === "merge") {
      merged.push(row);
    } else if (judged.band === "review") {
      review.push({
        a: { id: `fact:${pubName}`, name: pubName, address: boroughSlug },
        b: { id: row.venue.id, name: row.venue.name, address: row.venue.borough },
        distanceMetres: 0,
        probability: judged.probability,
      });
    }
  }

  const [only] = merged;
  if (only && merged.length === 1) {
    return {
      venueId: only.venue.id,
      confidence: only.confidence,
      review,
    };
  }
  return { venueId: null, confidence: null, review };
}
