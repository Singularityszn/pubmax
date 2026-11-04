// Your pubs in your own order, built the way a review app builds it: a band
// first (loved it, it was fine, not for me), then "which did you prefer?"
// against pubs already in that band until the new one has a place.
//
// The comparisons are a binary search, so a band of n pubs takes about
// log2(n) questions. Only the result is stored (migration 0186). The 0-10
// figure is DERIVED from band and place on every read and never stored.
// It is the person's own list: nothing public reads it (ADR 0017).

export const SOCIAL_PUB_BANDS = ["loved", "fine", "not_for_me"] as const;
export type SocialPubBand = (typeof SOCIAL_PUB_BANDS)[number];

export const SOCIAL_PUB_BAND_LABEL: Record<SocialPubBand, string> = {
  loved: "Loved it",
  fine: "It was fine",
  not_for_me: "Not for me",
};

/** Each band owns a stretch of the 0-10 scale; places share it evenly. */
const BAND_RANGE: Record<SocialPubBand, { top: number; bottom: number }> = {
  loved: { top: 10, bottom: 6.8 },
  fine: { top: 6.7, bottom: 3.4 },
  not_for_me: { top: 3.3, bottom: 0 },
};

export type SocialPubRankingRow = { venueId: string; band: SocialPubBand; rankKey: number; updatedAt: string };

export type SocialPubRankingEntry = {
  venueId: string;
  venueName: string | null;
  band: SocialPubBand;
  /** 1 for your favourite pub overall. */
  place: number;
  /** 0-10, from band and place inside it. */
  score: number;
  /** The cheapest price the map lists for the pub, when the read added it. */
  listedPrice?: number | null;
};

export function isSocialPubBand(value: unknown): value is SocialPubBand {
  return typeof value === "string" && (SOCIAL_PUB_BANDS as readonly string[]).includes(value);
}

/** The score at a place inside a band of `count`: the top of the band first, its floor last. */
export function socialPubBandScore(band: SocialPubBand, indexInBand: number, count: number): number {
  const { top, bottom } = BAND_RANGE[band];
  if (count <= 1) return top;
  const step = (top - bottom) / (count - 1);
  return Math.round((top - step * indexInBand) * 10) / 10;
}

/** Rows in stored order become places and scores. */
export function socialPubRankingEntries(
  rows: readonly SocialPubRankingRow[],
  names: ReadonlyMap<string, string> = new Map(),
): SocialPubRankingEntry[] {
  const ordered = SOCIAL_PUB_BANDS.flatMap((band) =>
    rows.filter((row) => row.band === band).sort((a, b) => a.rankKey - b.rankKey || a.venueId.localeCompare(b.venueId)));
  const counts = new Map<SocialPubBand, number>(SOCIAL_PUB_BANDS.map((band) => [band, ordered.filter((row) => row.band === band).length]));
  const seen = new Map<SocialPubBand, number>();
  return ordered.map((row, index) => {
    const indexInBand = seen.get(row.band) ?? 0;
    seen.set(row.band, indexInBand + 1);
    return {
      venueId: row.venueId,
      venueName: names.get(row.venueId) ?? null,
      band: row.band,
      place: index + 1,
      score: socialPubBandScore(row.band, indexInBand, counts.get(row.band) ?? 1),
    };
  });
}

/**
 * One comparison session: the pubs already in the band (best first, the new
 * pub left out) and the window still open. `low` is the first slot the new
 * pub could take, `high` one past the last.
 */
export type SocialPubComparison = { band: readonly string[]; low: number; high: number };

export function startSocialPubComparison(bandVenueIds: readonly string[], newVenueId: string): SocialPubComparison {
  const band = bandVenueIds.filter((id) => id !== newVenueId);
  return { band, low: 0, high: band.length };
}

/** The pub to ask about next, or null when the new pub has its place. */
export function nextSocialPubOpponent(session: SocialPubComparison): string | null {
  if (session.low >= session.high) return null;
  return session.band[Math.floor((session.low + session.high) / 2)] ?? null;
}

/**
 * Narrows the window by one answer. "new" puts the new pub above the one
 * asked about, "existing" below it, "tie" settles it just below.
 */
export function answerSocialPubComparison(
  session: SocialPubComparison,
  preferred: "new" | "existing" | "tie",
): SocialPubComparison {
  const mid = Math.floor((session.low + session.high) / 2);
  if (preferred === "new") return { ...session, high: mid };
  if (preferred === "existing") return { ...session, low: mid + 1 };
  return { ...session, low: mid + 1, high: mid + 1 };
}

/** The rank card after a visit asks at most this many "which did you prefer?" questions. */
export const RANK_AFTER_VISIT_MAX_COMPARISONS = 3;

/**
 * Settles an open window where it stands: the slot the next question would
 * have split on. Used when the rank card has asked its three questions, so a
 * long list costs three taps and lands the pub close to where it belongs.
 */
export function settleSocialPubComparison(session: SocialPubComparison): SocialPubComparison {
  if (session.low >= session.high) return session;
  const slot = Math.floor((session.low + session.high) / 2);
  return { ...session, low: slot, high: slot };
}

/** The settled slot as the two neighbours the server places between. */
export function socialPubComparisonNeighbours(session: SocialPubComparison): { aboveVenueId: string | null; belowVenueId: string | null } {
  const slot = session.low;
  return {
    aboveVenueId: slot > 0 ? session.band[slot - 1] ?? null : null,
    belowVenueId: session.band[slot] ?? null,
  };
}
