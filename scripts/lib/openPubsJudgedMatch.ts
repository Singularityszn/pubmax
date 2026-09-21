/**
 * Judged Open Pubs identity match (requires TYPESAFE_API_KEY).
 *
 * Cheap gates: distance + postcode + shared tokens (exact / identity / shared
 * distinctive token). The same-pub Noul decides. Review-band and ambiguous
 * merges never auto-match. Keyless classifyOpenPubMatch is unchanged.
 */

// @ts-expect-error -- untyped .mjs module (allowJs is off; judged .ts needs the leaf)
import { collectOpenPubIdentityCandidates } from "./openPubs.mjs";

type OpenPubsRow = {
  fsaId: number;
  name: string;
  address: string;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
};

type IdentityIndex = { byCell: Map<string, unknown[]>; size: number };
import {
  judgeSamePubPair,
  requiresTypesafeKeyMessage,
  snippetFromVenueGroup,
  typesafeConfigured,
} from "@/lib/samePubIdentity";
import type { SamePubReviewEntry } from "./samePubJudgedCanonicalize";

export type JudgedOpenPubClassification = {
  status: "matched" | "unmatched" | "ambiguous" | "skipped";
  match: {
    id: string;
    layer: "curated" | "osm";
    name: string;
    matchType: string;
    distanceM: number;
  } | null;
  review: SamePubReviewEntry[];
  reason: string | null;
};

export async function judgedClassifyOpenPubMatch(
  row: OpenPubsRow,
  index: IdentityIndex,
  opts: { radiusM?: number } = {},
): Promise<JudgedOpenPubClassification> {
  if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
    return {
      status: "skipped",
      match: null,
      review: [],
      reason: "no-coords",
    };
  }
  if (!typesafeConfigured()) {
    throw new Error(requiresTypesafeKeyMessage());
  }

  const hits = collectOpenPubIdentityCandidates(row, index, {
    ...opts,
    sharedTokenGate: true,
  });
  if (hits.length === 0) {
    return {
      status: "unmatched",
      match: null,
      review: [],
      reason: "no-identity-match",
    };
  }

  const review: SamePubReviewEntry[] = [];
  const merged = [];
  for (const hit of hits) {
    const judged = await judgeSamePubPair({
      a: snippetFromVenueGroup({
        name: row.name,
        address: row.address ?? row.postcode ?? "",
        operator: null,
        website: null,
      }),
      b: snippetFromVenueGroup({
        name: hit.name,
        address: hit.address ?? "",
        operator: null,
        website: null,
      }),
      distanceMetres: Math.round(hit.distanceM),
    });
    if (!judged) {
      throw new Error(
        `A judged Open Pubs pass could not reach TypeSafe for ${row.name} / ${hit.id}.`,
      );
    }
    if (judged.band === "merge") {
      merged.push(hit);
    } else if (judged.band === "review") {
      review.push({
        a: {
          id: `fsa:${row.fsaId}`,
          name: row.name,
          address: row.address ?? "",
        },
        b: { id: hit.id, name: hit.name, address: hit.address ?? "" },
        distanceMetres: Math.round(hit.distanceM),
        probability: judged.probability,
      });
    }
  }

  if (merged.length === 1) {
    const best = merged[0];
    return {
      status: "matched",
      match: {
        id: best.id,
        layer: best.layer,
        name: best.name,
        matchType: best.matchType,
        distanceM: Math.round(best.distanceM),
      },
      review,
      reason: null,
    };
  }
  if (merged.length > 1) {
    return {
      status: "ambiguous",
      match: null,
      review,
      reason: "ambiguous-identity",
    };
  }
  return {
    status: "unmatched",
    match: null,
    review,
    reason: review.length > 0 ? "review-band" : "no-identity-match",
  };
}
