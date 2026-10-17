import { describe, expect, it } from "vitest";

import {
  SOCIAL_POST_CONTROL_LINE,
  SOCIAL_POST_ORDER_LINE,
  SOCIAL_POST_REASONS,
  socialPostReason,
  socialPostReasonLine,
  type SocialPostLane,
} from "@/lib/socialPostReason";
import { createMemorySocialPostStore, type SocialPostActor } from "@/lib/socialPostStore";
import { validateSocialPostCreate } from "@/lib/socialPosts";

const alice: SocialPostActor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const bob: SocialPostActor = { accountId: "account-b", profileId: "profile-b", handle: "bob" };
const carol: SocialPostActor = { accountId: "account-c", profileId: "profile-c", handle: "carol" };

function fields(overrides: Record<string, unknown> = {}) {
  const result = validateSocialPostCreate({
    kind: "standard",
    visibility: "public",
    body: "A post",
    area: "camden",
    hashtags: [],
    commentPolicy: "open",
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("why a Social post is in a lane", () => {
  it("names the lane rule that let the post in", () => {
    const theirs = { ownedByViewer: false } as const;
    expect(socialPostReason("following", { ...theirs, visibility: "public" })).toBe("you_follow");
    expect(socialPostReason("following", { ...theirs, visibility: "friends" })).toBe("mutuals_only");
    expect(socialPostReason("nearby", { ...theirs, visibility: "public" })).toBe("area_tag");
    expect(socialPostReason("discover", { ...theirs, visibility: "public" })).toBe("across_town");
    for (const lane of ["following", "nearby", "discover"] as const) {
      expect(socialPostReason(lane, { ownedByViewer: true, visibility: "public" })).toBe("own_post");
    }
  });

  it("says each reason in one plain line", () => {
    const context = { handle: "alice", visibility: "public" as const, areaName: "Camden" };
    expect(socialPostReasonLine("you_follow", context)).toBe("You follow @alice.");
    expect(socialPostReasonLine("mutuals_only", context))
      .toBe("You and @alice follow each other, and this one is for mutuals only.");
    expect(socialPostReasonLine("area_tag", context)).toBe("It's a public post tagged Camden.");
    expect(socialPostReasonLine("area_tag", { ...context, areaName: null }))
      .toBe("It's a public post tagged this area.");
    expect(socialPostReasonLine("across_town", context)).toBe("It's a public post from across town.");
    expect(socialPostReasonLine("own_post", context)).toBe("It's your post. Anyone on Social can see it.");
    expect(socialPostReasonLine("own_post", { ...context, visibility: "friends" }))
      .toBe("It's your post. Only your mutuals can see it.");
    expect(socialPostReasonLine("own_post", { ...context, visibility: "private" }))
      .toBe("It's your post. Only you can see it.");
  });

  it("never claims a ranking, and says who decides the order", () => {
    const lines = [
      SOCIAL_POST_ORDER_LINE,
      SOCIAL_POST_CONTROL_LINE,
      ...SOCIAL_POST_REASONS.map((reason) =>
        socialPostReasonLine(reason, { handle: "alice", visibility: "public", areaName: "Camden" })),
    ];
    expect(SOCIAL_POST_ORDER_LINE).toMatch(/^Newest first\./);
    for (const line of lines) {
      expect(line).not.toMatch(/[—!]|for you|popular|trending|recommend/i);
    }
  });

  it("agrees with the lane rules the memory feed applies", async () => {
    let tick = Date.parse("2026-08-05T18:00:00.000Z");
    const store = createMemorySocialPostStore({
      now: () => new Date(tick += 1_000),
      relationships: async (viewer) => viewer.profileId === bob.profileId
        ? { followingProfileIds: new Set([alice.profileId]), mutualProfileIds: new Set([alice.profileId]) }
        : { followingProfileIds: new Set(), mutualProfileIds: new Set() },
    });
    await store.create(alice, fields({ body: "alice public" }));
    await store.create(alice, fields({ body: "alice friends", visibility: "friends" }));
    await store.create(carol, fields({ body: "carol public" }));
    await store.create(bob, fields({ body: "bob public" }));
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

    const reasons = async (lane: SocialPostLane) => {
      const page = await store.feed(bob, lane === "nearby" ? { lane, area: "camden" } : { lane });
      return Object.fromEntries(page.posts.map((post) => [post.body, socialPostReason(lane, post)]));
    };
    expect(await reasons("following")).toEqual({
      "alice friends": "mutuals_only",
      "alice public": "you_follow",
    });
    expect(await reasons("nearby")).toEqual({
      "bob public": "own_post",
      "carol public": "area_tag",
      "alice public": "area_tag",
    });
    expect(await reasons("discover")).toEqual({
      "bob public": "own_post",
      "carol public": "across_town",
      "alice public": "across_town",
    });
  });
});
