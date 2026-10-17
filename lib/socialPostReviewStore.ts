import "server-only";

import {
  rankSocialReviews,
  type SocialLotRankingEntry,
  type SocialLotVenueReview,
  type SocialPostReview,
  type SocialPubRankingEntry,
} from "@/lib/socialPostReviews";
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
  /** Your lot's pubs: mutual friends' newest scores averaged, for this reader only. */
  lotRanking(actor: ReviewActor, limit?: number): Promise<Array<Omit<SocialLotRankingEntry, "venueName">>>;
  /** Your lot's scored posts about one pub, newest first, for this reader only (0187). */
  lotVenueReviews(actor: ReviewActor, venueId: string, limit?: number): Promise<SocialLotVenueReview[]>;
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
    // Process memory knows scores but not who follows whom or who may read
    // which post, so it answers no lot rather than a wrong one.
    async lotRanking() {
      return [];
    },
    async lotVenueReviews() {
      return [];
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
    return onMissingDurableWrite({ storeTag: "social-post-reviews", migrationHint: "apply migration 0182", fallback });
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
  async lotRanking(actor, limit = 50) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_lot_social_pub_ranking", {
        p_viewer_profile_id: actor.profileId,
        p_limit: limit,
      });
      if (error) {
        // A deploy that runs ahead of 0184 shows an empty lot, not an error.
        if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) return [];
        throw error;
      }
      return (data ?? []).map((row) => ({
        venueId: String(row.venue_id),
        averageRating: Number(row.average_rating),
        raterCount: Number(row.rater_count),
        raterHandles: Array.isArray(row.rater_handles) ? row.rater_handles.map(String) : [],
        lastReviewedAt: String(row.last_reviewed_at),
      }));
    }, () => memorySocialPostReviewStore.lotRanking(actor, limit), false);
  },
  async lotVenueReviews(actor, venueId, limit = 20) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_lot_venue_social_reviews", {
        p_viewer_profile_id: actor.profileId,
        p_venue_id: venueId,
        p_limit: limit,
      });
      if (error) {
        // A deploy that runs ahead of 0187 shows no lot section, not an error.
        if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) return [];
        throw error;
      }
      return (data ?? []).map((row) => ({
        postId: String(row.post_id),
        authorProfileId: String(row.author_profile_id),
        authorHandle: String(row.author_handle),
        rating: Number(row.rating),
        body: String(row.body ?? ""),
        photo: row.photo_media_id
          ? { url: `/api/social/media/${row.photo_media_id}`, altText: String(row.photo_alt_text ?? "") }
          : null,
        createdAt: String(row.created_at),
      }));
    }, () => memorySocialPostReviewStore.lotVenueReviews(actor, venueId, limit), false);
  },
};

export function socialPostReviewStore(): SocialPostReviewStore {
  return selectStore(memorySocialPostReviewStore, supabaseSocialPostReviewStore);
}
