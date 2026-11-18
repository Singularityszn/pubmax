import type { SocialPostDTO } from "@/lib/socialPosts";

export type SocialPostFeedLane = "following" | "nearby" | "discover";

type FeedFields = Pick<SocialPostDTO, "visibility" | "area" | "hashtags" | "nameHidden" | "moderationState">;

// Relationship access remains server-owned.
export function matchesSocialPostFeedSelection(
  post: FeedFields,
  lane: SocialPostFeedLane,
  area?: string | null,
  tag?: string | null,
): boolean {
  if (post.moderationState !== "approved") return false;
  if (lane === "following") return !post.nameHidden && post.visibility !== "private";
  if (post.visibility !== "public") return false;
  return lane === "nearby" ? post.area === area : !tag || post.hashtags.includes(tag);
}
