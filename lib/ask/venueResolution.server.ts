import "server-only";

import { systemOne } from "@/lib/ai/typesafe.server";
import {
  collectVenueNameCandidates,
  intendedVenueQuestions,
  INTENDED_VENUE_FLOOR,
  matchVenueByNameKeyless,
  optionIndex,
  pickIntendedVenueOption,
  toVenueResolutionCandidate,
  uniqueExactVenueNameMatch,
  type VenueNameMatchInput,
  venueResolutionState,
} from "@/lib/ask/venueResolution";

/**
 * Resolve a typed pub name against the listed index.
 *
 * Unique exact match skips the model. Otherwise TypeSafe Choice over token
 * candidates plus none, with today's matcher as the no-key / failed-call
 * fallback. A judged none or below-floor answer returns null rather than the
 * substring winner.
 */
export async function matchVenueByName<T extends VenueNameMatchInput>(
  venues: readonly T[],
  name: string,
): Promise<T | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const uniqueExact = uniqueExactVenueNameMatch(venues, trimmed);
  if (uniqueExact) return uniqueExact;

  const keyless = matchVenueByNameKeyless(venues, trimmed);
  const candidates = collectVenueNameCandidates(venues, trimmed);
  if (candidates.length === 0) return keyless;

  const snippets = candidates.map(toVenueResolutionCandidate);
  const response = await systemOne(
    venueResolutionState(trimmed, snippets),
    intendedVenueQuestions(snippets),
    { lane: "typesafe", timeoutMs: 4_000 },
  );
  if (!response) return keyless;

  const answer = response.answers.intendedVenue;
  const option = pickIntendedVenueOption(
    answer?.choice,
    answer?.probabilities,
    INTENDED_VENUE_FLOOR,
  );
  if (!option) return null;
  const index = optionIndex(option);
  if (index == null) return null;
  return candidates[index] ?? null;
}
