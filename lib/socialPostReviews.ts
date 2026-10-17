// A Social review is one person's own score for the pub their post names.
//
// It is a fact about that post and nothing else: no venue rating, price or
// map ranking reads it, and nothing adds scores up across people
// (docs/social/SOCIAL_BETA_CONTRACT.md). The ranking a person sees is their
// own list, newest score per pub, best first.

export const SOCIAL_REVIEW_MIN = 1;
export const SOCIAL_REVIEW_MAX = 5;
export const SOCIAL_REVIEW_STEP = 0.5;

export type SocialPostReview = { rating: number };

export type SocialPubRankingEntry = {
  postId: string;
  venueId: string;
  venueName: string | null;
  rating: number;
  reviewedAt: string;
};

/** The score on the half-step scale from 1 to 5, or null for anything else. */
export function parseSocialReviewRating(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < SOCIAL_REVIEW_MIN || value > SOCIAL_REVIEW_MAX) return null;
  return Number.isInteger(value * 2) ? value : null;
}

/** "4.5" for a half step, "4" for a whole one. */
export function formatSocialReviewRating(rating: number): string {
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

/** How many of the five stars are full, half and empty for a score. */
export function socialReviewStars(rating: number): { full: number; half: boolean; empty: number } {
  const full = Math.floor(rating);
  const half = rating - full >= SOCIAL_REVIEW_STEP;
  return { full, half, empty: SOCIAL_REVIEW_MAX - full - (half ? 1 : 0) };
}

/** Newest score per venue, best first, ties broken by the newer score. */
export function rankSocialReviews(
  entries: readonly SocialPubRankingEntry[],
  limit = 50,
): SocialPubRankingEntry[] {
  const newestPerVenue = new Map<string, SocialPubRankingEntry>();
  for (const entry of entries) {
    const held = newestPerVenue.get(entry.venueId);
    if (!held || entry.reviewedAt > held.reviewedAt) newestPerVenue.set(entry.venueId, entry);
  }
  return [...newestPerVenue.values()]
    .sort((left, right) => right.rating - left.rating
      || right.reviewedAt.localeCompare(left.reviewedAt)
      || right.postId.localeCompare(left.postId))
    .slice(0, Math.max(1, limit));
}

/**
 * One pub in your lot's ranking: each mutual friend's newest score averaged.
 * Only for the reader it was read for; nothing else reads it (migration 0183).
 */
export type SocialLotRankingEntry = {
  venueId: string;
  venueName: string | null;
  averageRating: number;
  raterCount: number;
  raterHandles: string[];
  lastReviewedAt: string;
};

/** One scored post a mutual friend wrote about a pub (migration 0186). */
export type SocialLotVenueReview = {
  postId: string;
  authorHandle: string;
  rating: number;
  body: string;
  photo: { url: string; altText: string } | null;
  createdAt: string;
};

/** Each friend's newest score for the pub, averaged, to one decimal. */
export function lotVenueAverage(reviews: readonly SocialLotVenueReview[]): { average: number; raters: number } | null {
  const newest = new Map<string, SocialLotVenueReview>();
  for (const review of reviews) {
    const held = newest.get(review.authorHandle);
    if (!held || review.createdAt > held.createdAt) newest.set(review.authorHandle, review);
  }
  if (newest.size === 0) return null;
  const total = [...newest.values()].reduce((sum, review) => sum + review.rating, 0);
  return { average: Math.round((total / newest.size) * 10) / 10, raters: newest.size };
}
