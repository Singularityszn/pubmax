// NHLE listing-structure judgments (TypeSafe lane).
//
// Replaces the STRUCTURE_DENY token table on the judged heritage path.
// Thresholds are set from recorded fixtures:
// __tests__/fixtures/typesafe/heritage-structure-probabilities.json

import { noul } from "@typesafe-ai/sdk";

import { systemOne, typesafeConfigured } from "@/lib/ai/typesafe";
import { isSamePubProbability } from "@/lib/samePubIdentity";

export { typesafeConfigured };

/** Treat as the pub building when P(yes) is at or above this. */
export const HERITAGE_STRUCTURE_ACCEPT_THRESHOLD = 0.8; // fixtures: __tests__/fixtures/typesafe/heritage-structure-probabilities.json

/** Treat as an adjacent structure when P(yes) is at or below this. */
export const HERITAGE_STRUCTURE_REFUSE_THRESHOLD = 0.35; // fixtures: __tests__/fixtures/typesafe/heritage-structure-probabilities.json

export type HeritageStructureState = {
  listing: { name: string };
  pub: { name: string };
};

export type HeritageStructureBand = "accept" | "refuse" | "review";

const HERITAGE_STRUCTURE_QUESTIONS = {
  listingIsPubBuilding: noul({
    instructions: {
      question:
        "Does `listing.name` describe the pub building itself rather than an adjacent structure?",
      inspect: "listing.name",
      compare: ["listing.name", "pub.name"],
      focus:
        "Count a listing that names the drinking house (public house, inn, tavern, hotel) as the building. Count stables, a gateway, railings, a wall, a monument, a fountain, a social club, a church, or any listing that says the public house is not included as an adjacent structure.",
    },
    criteria: {
      true: {
        what: "The listing is the pub building",
        examples: [
          "THE GATE PUBLIC HOUSE for The Gate",
          "PROSPECT OF WHITBY PUBLIC HOUSE for The Prospect of Whitby",
          "THE OLD WINDMILL PUBLIC HOUSE AND RESTAURANT for The Old Windmill",
        ],
      },
      false: {
        what: "An adjacent structure that only mentions the pub",
        examples: [
          "STABLES IN REAR YARD OF THE DUKE OF HAMILTON PUBLIC HOUSE (PUBLIC HOUSE NOT INCLUDED)",
          "RAILINGS TO THE CROWN PUBLIC HOUSE",
          "TOTTENHAM HIGH CROSS",
        ],
      },
    },
  }),
};

export function isHeritageStructureProbability(value: unknown): value is number {
  return isSamePubProbability(value);
}

export function bandFromHeritageStructureProbability(pYes: unknown): HeritageStructureBand {
  if (!isHeritageStructureProbability(pYes)) return "refuse";
  if (pYes >= HERITAGE_STRUCTURE_ACCEPT_THRESHOLD) return "accept";
  if (pYes <= HERITAGE_STRUCTURE_REFUSE_THRESHOLD) return "refuse";
  return "review";
}

export type HeritageStructureJudgment = {
  probability: number;
  band: HeritageStructureBand;
  model: string | null;
};

export async function judgeHeritageListingStructure(
  state: HeritageStructureState,
): Promise<HeritageStructureJudgment | null> {
  const response = await systemOne(state, HERITAGE_STRUCTURE_QUESTIONS, {
    lane: "heritage-structure",
    timeoutMs: 4_000,
  });
  if (!response) return null;
  const model = typeof response.model === "string" ? response.model : null;
  const answered: unknown = response.answers?.listingIsPubBuilding?.noul;
  if (!isHeritageStructureProbability(answered)) {
    return { probability: Number.NaN, band: "refuse", model };
  }
  return {
    probability: answered,
    band: bandFromHeritageStructureProbability(answered),
    model,
  };
}

export function requiresHeritageStructureKeyMessage(): string {
  return "A judged heritage-listing pass requires TYPESAFE_API_KEY.";
}
