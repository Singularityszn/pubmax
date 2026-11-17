// The quiet first-ten session and the save-recovery rule the comparison flow
// keeps. The server's ranking list is the only checkpoint: nothing here is
// stored, and progress moves only on a list the server answered.

import { socialPubRankingReadFailure, type SocialPubBand, type SocialPubRankingEntry } from "@/lib/socialPubRankings";

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
 * What a save answer that carried no list proves. "refused": this account may
 * not rank. "rejected": the route refused before it wrote, so its own reason
 * stands. "stale": the list moved and nothing was written. "unknown": the
 * write may have happened, so only a fresh list can tell.
 */
export type RankingSaveAnswer = "refused" | "rejected" | "stale" | "unknown";

// The 5xx codes app/api/social/rankings answers before it writes: the freeze,
// the access check and the venue lookup. RANKING_UNAVAILABLE can follow a
// write, so it is not here.
const REFUSED_BEFORE_WRITE = new Set(["SOCIAL_FROZEN", "SOCIAL_ACCESS_UNAVAILABLE", "VENUE_LOOKUP_UNAVAILABLE"]);

export function rankingSaveAnswer(status: number, body: unknown): RankingSaveAnswer {
  if (socialPubRankingReadFailure(status, body) === "refused") return "refused";
  const code = body !== null && typeof body === "object" && !Array.isArray(body) ? (body as { code?: unknown }).code : undefined;
  if (status === 409) return code === "STALE_RANKING" ? "stale" : "unknown";
  if (status >= 400 && status < 500) return "rejected";
  if (status >= 500 && typeof code === "string" && REFUSED_BEFORE_WRITE.has(code)) return "rejected";
  return "unknown";
}
