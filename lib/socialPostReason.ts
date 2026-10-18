// Why a Social post is in the lane the reader is looking at, said in words.
//
// The reasons are the lane rules read back, never a guess and never a score:
// `feedAllows` in `lib/socialPostStore.ts` and `read_social_post_feed` in SQL
// decide which posts a lane holds, and this leaf names which of those rules let
// this one in. Every lane is newest first and nothing is ranked by engagement
// (`docs/social/SOCIAL_BETA_CONTRACT.md`), so the order line is a fact, not a
// promise. Change a lane rule there and the reason here changes in the same
// commit; `__tests__/socialPostReason.test.ts` reads the memory feed back to
// hold the two together.

import type { SocialPostDTO, SocialPostVisibility } from "@/lib/socialPosts";

export type SocialPostLane = "following" | "nearby" | "discover";

export const SOCIAL_POST_REASONS = [
  "own_post",
  "you_follow",
  "mutuals_only",
  "area_tag",
  "across_town",
] as const;

export type SocialPostReason = (typeof SOCIAL_POST_REASONS)[number];

export const SOCIAL_POST_REASON_SUMMARY = "Why this post?";

export const SOCIAL_POST_ORDER_LINE =
  "Newest first. We don't rank posts by likes, and nobody can pay to be here.";

export const SOCIAL_POST_CONTROL_LINE =
  "Mute or block someone on their profile to stop seeing their posts.";

type ReasonPost = Pick<SocialPostDTO, "ownedByViewer" | "visibility">;

/** Which lane rule let this post in. Pure: the lane and the post decide it. */
export function socialPostReason(lane: SocialPostLane, post: ReasonPost): SocialPostReason {
  if (post.ownedByViewer) return "own_post";
  if (lane === "following") return post.visibility === "friends" ? "mutuals_only" : "you_follow";
  if (lane === "nearby") return "area_tag";
  return "across_town";
}

function ownAudience(visibility: SocialPostVisibility): string {
  if (visibility === "public") return "Anyone on Social can see it.";
  if (visibility === "friends") return "Only your mutuals can see it.";
  return "Only you can see it.";
}

/** The one line a reader gets for a reason. */
export function socialPostReasonLine(
  reason: SocialPostReason,
  context: { handle: string; visibility: SocialPostVisibility; areaName: string | null },
): string {
  switch (reason) {
    case "own_post":
      return `It's your post. ${ownAudience(context.visibility)}`;
    case "you_follow":
      return `You follow @${context.handle}.`;
    case "mutuals_only":
      return `You and @${context.handle} follow each other, and this one is for mutuals only.`;
    case "area_tag":
      return context.areaName
        ? `It's a public post tagged ${context.areaName}.`
        : "It's a public post tagged this area.";
    case "across_town":
      return "It's a public post from across town.";
  }
}
