import "server-only";

import { rankSocialReviews, type SocialPostReview, type SocialPubRankingEntry } from "@/lib/socialPostReviews";
import { isMissingTableSchema, onMissingDurableWrite, selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin, requiresSupabaseStore } from "@/lib/supabase";

type ReviewActor = { profileId: string };

export class SocialPostReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialPostReviewError";
  }
}

export type SocialPostReviewStore = {
  /** Scores the actor's own post, which must name a venue. Re-scoring replaces. */
  attach(actor: ReviewActor, post: { id: string; venueId: string }, rating: number): Promise<SocialPostReview>;
  /** Scores for posts the caller has already been allowed to read. */
  forPosts(postIds: readonly string[]): Promise<Map<string, SocialPostReview>>;
  /** The actor's own list: newest score per pub, best first. */
  ranking(actor: ReviewActor, limit?: number): Promise<Array<Omit<SocialPubRankingEntry, "venueName">>>;
};

type MemoryReview = {
  postId: string;
  authorProfileId: string;
  venueId: string;
  rating: number;
  updatedAt: string;
};

export function createMemorySocialPostReviewStore(options: { now?: () => Date } = {}): SocialPostReviewStore {
  const reviews = new Map<string, MemoryReview>();
  const now = options.now ?? (() => new Date());
  return {
    async attach(actor, post, rating) {
      const held = reviews.get(post.id);
      if (held && held.authorProfileId !== actor.profileId) throw new SocialPostReviewError("Social review post not found.");
      reviews.set(post.id, {
        postId: post.id,
        authorProfileId: actor.profileId,
        venueId: post.venueId,
        rating,
        updatedAt: now().toISOString(),
      });
      return { rating };
    },
    async forPosts(postIds) {
      const found = new Map<string, SocialPostReview>();
      for (const id of postIds) {
        const review = reviews.get(id);
        if (review) found.set(id, { rating: review.rating });
      }
      return found;
    },
    async ranking(actor, limit = 50) {
      const own = [...reviews.values()]
        .filter((review) => review.authorProfileId === actor.profileId)
        .map((review) => ({
          postId: review.postId,
          venueId: review.venueId,
          venueName: null,
          rating: review.rating,
          reviewedAt: review.updatedAt,
        }));
      return rankSocialReviews(own, limit).map((entry) => ({
        postId: entry.postId,
        venueId: entry.venueId,
        rating: entry.rating,
        reviewedAt: entry.reviewedAt,
      }));
    },
  };
}

const memorySocialPostReviewStore = createMemorySocialPostReviewStore();

async function durableOrMemory<T>(operation: () => Promise<T>, fallback: () => Promise<T>, write: boolean): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingTableSchema(error, ["social_post_reviews"])) throw error;
    if (requiresSupabaseStore()) throw error;
    if (!write) return fallback();
    return onMissingDurableWrite({ storeTag: "social-post-reviews", migrationHint: "apply migration 0181", fallback });
  }
}

const supabaseSocialPostReviewStore: SocialPostReviewStore = {
  async attach(actor, post, rating) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("attach_social_post_review", {
        p_post_id: post.id,
        p_author_profile_id: actor.profileId,
        p_rating: rating,
      });
      if (error) {
        if (/Social review/i.test(error.message)) throw new SocialPostReviewError(error.message);
        throw error;
      }
      const row = (data ?? [])[0] as { rating?: unknown } | undefined;
      if (!row) throw new Error("Social review was not saved.");
      return { rating: Number(row.rating) };
    }, () => memorySocialPostReviewStore.attach(actor, post, rating), true);
  },
  async forPosts(postIds) {
    if (postIds.length === 0) return new Map();
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin()
        .from("social_post_reviews")
        .select("post_id, rating")
        .in("post_id", [...postIds]);
      if (error) throw error;
      return new Map((data ?? []).map((row) => [String(row.post_id), { rating: Number(row.rating) }]));
    }, () => memorySocialPostReviewStore.forPosts(postIds), false);
  },
  async ranking(actor, limit = 50) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_own_social_pub_ranking", {
        p_author_profile_id: actor.profileId,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        postId: String(row.post_id),
        venueId: String(row.venue_id),
        rating: Number(row.rating),
        reviewedAt: String(row.reviewed_at),
      }));
    }, () => memorySocialPostReviewStore.ranking(actor, limit), false);
  },
};

export function socialPostReviewStore(): SocialPostReviewStore {
  return selectStore(memorySocialPostReviewStore, supabaseSocialPostReviewStore);
}
