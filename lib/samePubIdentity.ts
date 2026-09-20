// Same-pub identity judgments for venue canonicalisation (TypeSafe lane).
//
// Code finds candidate pairs (distance + shared distinctive tokens); Jev decides
// whether they are one physical pub. Thresholds are set from recorded fixtures:
// __tests__/fixtures/typesafe/same-pub-probabilities.json

import { noul } from "@typesafe-ai/sdk";

import { systemOne, typesafeConfigured } from "@/lib/ai/typesafe";
import {
  haversineMeters,
  namesLikelySamePub,
  normalizeVenueIdentityName,
  postcodeOutward,
  significantNameTokens,
} from "../scripts/lib/venueCanonicalization.mjs";

export const SAME_PUB_CANDIDATE_MAX_METRES = 120;

/** Merge when P(same) is at or above this; from same-pub-probabilities.json */
export const SAME_PUB_MERGE_THRESHOLD = 0.82; // fixtures: __tests__/fixtures/typesafe/same-pub-probabilities.json

/** Refuse merge when P(same) is at or below this; middle band goes to review */
export const SAME_PUB_REFUSE_THRESHOLD = 0.35; // fixtures: __tests__/fixtures/typesafe/same-pub-probabilities.json

export type SamePubVenueSnippet = {
  name: string;
  address: string;
  operator: string | null;
  website: string | null;
};

export type SamePubPairState = {
  a: SamePubVenueSnippet;
  b: SamePubVenueSnippet;
  distanceMetres: number;
};

export type SamePubBand = "merge" | "refuse" | "review";

const SAME_PUB_QUESTIONS = {
  samePhysicalPub: noul({
    instructions: {
      question: "Do `a` and `b` name the same single physical pub premises?",
      compare: ["a", "b"],
      focus:
        "Treat one venue recorded twice under a shorter name, a longer name, or an operator suffix as the same pub. Treat two different pubs that only share a locality word or one word of the name as different pubs.",
    },
    criteria: {
      true: {
        what: "One pub building, two directory or price rows",
        examples: [
          "Kings Head and Kings Head Tavern at the same door",
          "Moon on the Hill and Moon on the Hill - JD Wetherspoon",
          "Coach and Horses and Coach and Horses Pub",
        ],
      },
      false: {
        what: "Two distinct pubs, including neighbours with overlapping words",
        examples: [
          "The Bell and The Bell and Crown on the same street",
          "New Cross Inn and New Cross House",
          "Crown and Crown and Anchor",
        ],
      },
    },
  }),
};

export function snippetFromVenueGroup(g: {
  name: string;
  address: string;
  operator?: string | null;
  website?: string | null;
}): SamePubVenueSnippet {
  return {
    name: String(g.name ?? ""),
    address: String(g.address ?? ""),
    operator: g.operator ?? null,
    website: g.website ?? null,
  };
}

/** Cheap gate: geo + postcode consistency + at least one shared distinctive token. */
export function cheapSamePubCandidate(
  a: { lat: number; lng: number; address: string; normName: string },
  b: { lat: number; lng: number; address: string; normName: string },
  maxMetres: number = SAME_PUB_CANDIDATE_MAX_METRES,
): boolean {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return false;
  const distance = haversineMeters(a.lat, a.lng, b.lat, b.lng);
  if (distance > maxMetres) return false;
  const pa = postcodeOutward(a.address);
  const pb = postcodeOutward(b.address);
  if (pa && pb && pa !== pb) return false;
  const sigA = new Set(significantNameTokens(a.normName));
  const sigB = new Set(significantNameTokens(b.normName));
  if (sigA.size === 0 || sigB.size === 0) return false;
  for (const t of sigA) {
    if (sigB.has(t)) return true;
  }
  return false;
}

export function bandFromSamePubProbability(pSame: number): SamePubBand {
  if (pSame >= SAME_PUB_MERGE_THRESHOLD) return "merge";
  if (pSame <= SAME_PUB_REFUSE_THRESHOLD) return "refuse";
  return "review";
}

export async function judgeSamePubPair(
  state: SamePubPairState,
): Promise<{ probability: number; band: SamePubBand } | null> {
  const response = await systemOne(state, SAME_PUB_QUESTIONS, {
    lane: "same-pub",
    timeoutMs: 4_000,
  });
  if (!response) return null;
  const probability = response.answers.samePhysicalPub.noul;
  return { probability, band: bandFromSamePubProbability(probability) };
}

/** Keyless rule used by unit tests and `npm run dev` with no secrets. */
export function keylessSamePubMatch(aNorm: string, bNorm: string): boolean {
  return namesLikelySamePub(aNorm, bNorm);
}

export function requiresTypesafeKeyMessage(): string {
  return "A judged same-pub canonicalisation pass requires TYPESAFE_API_KEY.";
}

export { normalizeVenueIdentityName, typesafeConfigured };
