import "server-only";

import { systemOne } from "@/lib/ai/typesafe.server";
import {
  judgeSamePubPair,
  snippetFromVenueGroup,
  type SamePubPairState,
} from "@/lib/samePubIdentity";
import {
  cheapTonightVenueCandidate,
  opportunityMatchesVenue,
  type TonightOpportunity,
  type VenueRef,
} from "@/lib/tonight";
import { haversineKm } from "@/lib/haversine";

function distanceMetres(op: TonightOpportunity, venue: VenueRef): number {
  const loc = op.place?.location;
  if (
    !loc ||
    !Number.isFinite(loc.lat) ||
    !Number.isFinite(loc.lng) ||
    typeof venue.latitude !== "number" ||
    typeof venue.longitude !== "number" ||
    !Number.isFinite(venue.latitude) ||
    !Number.isFinite(venue.longitude)
  ) {
    return 0;
  }
  return Math.round(haversineKm([loc.lng, loc.lat], [venue.longitude, venue.latitude]) * 1000);
}

function pairState(op: TonightOpportunity, venue: VenueRef): SamePubPairState {
  return {
    a: snippetFromVenueGroup({
      name: op.place?.name ?? "",
      address: "",
      operator: null,
      website: null,
    }),
    b: snippetFromVenueGroup({
      name: venue.name,
      address: "",
      operator: null,
      website: null,
    }),
    distanceMetres: distanceMetres(op, venue),
  };
}

/**
 * Request-path same-pub join for tonight opportunities.
 *
 * Cheap gates stay in lib/tonight.ts. The Noul decides. A timeout, a missing
 * key, a spent budget or a malformed answer falls back to today's keyless
 * rule and never throws.
 */
export async function opportunityMatchesVenueJudged(
  op: TonightOpportunity,
  venue: VenueRef,
): Promise<boolean> {
  if (!cheapTonightVenueCandidate(op, venue)) return false;
  try {
    const judged = await judgeSamePubPair(pairState(op, venue), (state, questions, options) =>
      systemOne(state, questions, { timeoutMs: options.timeoutMs, lane: "typesafe" }),
    );
    if (!judged || !Number.isFinite(judged.probability)) {
      return opportunityMatchesVenue(op, venue);
    }
    return judged.band === "merge";
  } catch {
    return opportunityMatchesVenue(op, venue);
  }
}
