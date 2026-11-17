// The quiet first-ten session and the save-recovery rule the comparison flow
// keeps. The server's ranking list is the only checkpoint: nothing here is
// stored, and progress moves only on a list the server answered.

import type { SocialPubBand, SocialPubRankingEntry } from "@/lib/socialPubRankings";

export const FIRST_TEN_GOAL = 10;

/** Pubs on the list, each counted once. */
export function firstTenCount(entries: readonly Pick<SocialPubRankingEntry, "venueId">[]): number {
  return new Set(entries.map((entry) => entry.venueId)).size;
}

export function firstTenProgressLine(count: number): string {
  return count >= FIRST_TEN_GOAL ? "Your first ten are in." : `${count} of ${FIRST_TEN_GOAL} ranked`;
}

/**
 * Whether a list read after a lost save answer shows that exact save: the pub
 * in the band it was given, between the two neighbours it was placed between.
 * Anything else is not proof, so the person is asked again.
 */
export function rankingSaveLanded(
  entries: readonly Pick<SocialPubRankingEntry, "venueId" | "band">[],
  venueId: string,
  band: SocialPubBand,
  neighbours: { aboveVenueId: string | null; belowVenueId: string | null },
): boolean {
  const inBand = entries.filter((entry) => entry.band === band).map((entry) => entry.venueId);
  const index = inBand.indexOf(venueId);
  if (index === -1) return false;
  return (inBand[index - 1] ?? null) === neighbours.aboveVenueId && (inBand[index + 1] ?? null) === neighbours.belowVenueId;
}

/**
 * A refused read hides the list. Only a read that may answer next time is
 * shown as unavailable, and neither is ever an empty list.
 */
export function rankingReadFailure(status: number, code: unknown, retryable?: unknown): "refused" | "unavailable" {
  if (status === 401 || status === 403) return "refused";
  if (status === 503 && code === "SOCIAL_ACCESS_UNAVAILABLE" && retryable !== true) return "refused";
  return "unavailable";
}
