/**
 * Judged NHLE heritage match (requires TYPESAFE_API_KEY).
 *
 * Cheap gates stay in heritageMatch.mjs (distance + shared tokens). The
 * structure Noul replaces STRUCTURE_DENY; the same-pub Noul decides identity.
 * Review-band pairs never auto-match.
 */

import {
  cheapHeritageMatch,
  type HeritageListing,
  type HeritagePub,
} from "./heritageMatch.mjs";
import { haversineMeters } from "./geo.mjs";
import {
  judgeHeritageListingStructure,
  requiresHeritageStructureKeyMessage,
  typesafeConfigured,
} from "@/lib/heritageListingStructure";
import {
  judgeSamePubPair,
  snippetFromVenueGroup,
  type SamePubBand,
} from "@/lib/samePubIdentity";
import type { SamePubReviewEntry } from "./samePubJudgedCanonicalize";

export type JudgedHeritageMatch = {
  matched: boolean;
  listing: HeritageListing | null;
  distanceM: number;
  structureBand: "accept" | "refuse" | "review" | null;
  samePubBand: SamePubBand | null;
  review: SamePubReviewEntry | null;
};

function reviewEntry(
  pub: HeritagePub & { id?: string },
  listing: HeritageListing,
  distanceM: number,
  probability: number,
): SamePubReviewEntry {
  return {
    a: {
      id: pub.id ?? `pub:${pub.name}`,
      name: pub.name,
      address: "",
    },
    b: {
      id: `list:${listing.listEntry ?? listing.name}`,
      name: listing.name,
      address: "",
    },
    distanceMetres: Math.round(distanceM),
    probability,
  };
}

export async function judgedEvaluateMatch(
  pub: HeritagePub & { id?: string; address?: string },
  listing: HeritageListing,
): Promise<JudgedHeritageMatch> {
  if (!typesafeConfigured()) {
    throw new Error(requiresHeritageStructureKeyMessage());
  }

  const cheap = cheapHeritageMatch(pub, listing);
  if (!cheap.matched) {
    return {
      matched: false,
      listing: null,
      distanceM: cheap.distanceM,
      structureBand: null,
      samePubBand: null,
      review: null,
    };
  }

  const structure = await judgeHeritageListingStructure({
    listing: { name: listing.name },
    pub: { name: pub.name },
  });
  if (!structure) {
    throw new Error(
      `A judged heritage pass could not reach TypeSafe for structure on ${pub.name} / ${listing.name}.`,
    );
  }
  if (structure.band !== "accept") {
    return {
      matched: false,
      listing: null,
      distanceM: cheap.distanceM,
      structureBand: structure.band,
      samePubBand: null,
      review:
        structure.band === "review"
          ? reviewEntry(pub, listing, cheap.distanceM, structure.probability)
          : null,
    };
  }

  const distanceMetres = Math.round(
    Number.isFinite(cheap.distanceM)
      ? cheap.distanceM
      : haversineMeters(pub.lat, pub.lng, listing.lat, listing.lng),
  );
  const same = await judgeSamePubPair({
    a: snippetFromVenueGroup({
      name: pub.name,
      address: pub.address ?? "",
      operator: null,
      website: null,
    }),
    b: snippetFromVenueGroup({
      name: listing.name,
      address: "",
      operator: null,
      website: null,
    }),
    distanceMetres,
  });
  if (!same) {
    throw new Error(
      `A judged heritage pass could not reach TypeSafe for same-pub on ${pub.name} / ${listing.name}.`,
    );
  }
  if (same.band === "merge") {
    return {
      matched: true,
      listing,
      distanceM: cheap.distanceM,
      structureBand: "accept",
      samePubBand: "merge",
      review: null,
    };
  }
  return {
    matched: false,
    listing: null,
    distanceM: cheap.distanceM,
    structureBand: "accept",
    samePubBand: same.band,
    review:
      same.band === "review" ? reviewEntry(pub, listing, cheap.distanceM, same.probability) : null,
  };
}

export async function judgedBestMatch(
  pub: HeritagePub & { id?: string; address?: string },
  candidates: HeritageListing[],
): Promise<{ match: JudgedHeritageMatch | null; review: SamePubReviewEntry[] }> {
  const review: SamePubReviewEntry[] = [];
  let best: JudgedHeritageMatch | null = null;
  for (const listing of candidates) {
    const result = await judgedEvaluateMatch(pub, listing);
    if (result.review) review.push(result.review);
    if (!result.matched) continue;
    if (
      !best ||
      result.distanceM < best.distanceM ||
      (result.distanceM === best.distanceM &&
        Number(listing.listEntry) < Number(best.listing?.listEntry))
    ) {
      best = result;
    }
  }
  return { match: best, review };
}
