// The one shape every Night OS Ask tool answers in (ADR 0014).
//
// It lives apart from `lib/ask/tools.ts` so a handler module can be imported
// BY the registry without importing the registry back. `tools.ts` re-exports
// these names, so every existing caller is untouched.

import type { CityId } from "@/lib/cities";
import type { AskCard, AskMenuEvidence, AskProposal, AskSource, AskToolName } from "@/lib/ask/types";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";

export type AskPriceEvidence = {
  cardKey: string;
  venueId: string;
  priceGbp: number;
} & (
  | { kind: "listed-pint"; category: "beer"; source: "directory"; reportedAt: null; serving: "pint" }
  | { kind: "community-category"; category: DrinkCategory; source: "community-price"; reportedAt: number; serving: null }
  | AskMenuEvidence
);

export function listedPintEvidence(cardKey: string, venueId: string, priceGbp: number): AskPriceEvidence {
  return { kind: "listed-pint", cardKey, venueId, priceGbp, category: "beer", source: "directory", reportedAt: null, serving: "pint" };
}

export function communityCategoryEvidence(cardKey: string, venueId: string, price: CommunityPrice): AskPriceEvidence {
  return {
    kind: "community-category", cardKey, venueId, priceGbp: price.priceGbp, category: price.drinkCategory,
    source: "community-price", reportedAt: price.submittedAt, serving: null,
  };
}

export type AskProvenance = AskSource;

export type AskToolResult = {
  ok: boolean;
  tool: AskToolName;
  data: unknown;
  provenance: AskProvenance[];
  cards: AskCard[];
  priceEvidence?: AskPriceEvidence[];
  resolvedVenueId?: string;
  proposals: AskProposal[];
  answerHint: string;
  degraded?: boolean;
};

export type AskToolArgs = Record<string, unknown>;

export type AskToolContext = {
  cityId: CityId;
  query: string;
  /** Skip paid intent assist inside search_venues / propose_plan. */
  skipModel?: boolean;
  fetchImpl?: typeof fetch;
  /** Injected clock, so a "what is on right now" answer is testable. */
  now?: number;
};
