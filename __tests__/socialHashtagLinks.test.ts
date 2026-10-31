import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/social",
  useRouter: () => ({ prefetch: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import SocialPostCard from "@/components/social/SocialPostCard";
import { normalizeSocialHashtag } from "@/lib/socialHashtag";
import type { SocialPostDTO } from "@/lib/socialPosts";
import {
  parseSocialShellSearch,
  socialFeedRequestHref,
  socialTagHref,
} from "@/lib/socialShell";

const post: SocialPostDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "standard",
  visibility: "public",
  body: "A tagged post",
  area: null,
  venueId: null,
  venueProjected: false,
  hashtags: ["quietpint", "sunday_roast"],
  commentPolicy: "open",
  nameHidden: false,
  photo: null,
  moderationState: "approved",
  featureRequest: null,
  revision: 0,
  mutationVersion: 0,
  editedAt: null,
  createdAt: "2026-10-30T12:00:00.000Z",
  updatedAt: "2026-10-30T12:00:00.000Z",
  author: { handle: "alice" },
  ownedByViewer: false,
  venueName: null,
};

describe("a hashtag on a post card is a way in", () => {
  it("renders each hashtag as a link to Across town filtered to it", () => {
    const html = renderToStaticMarkup(createElement(SocialPostCard, { post }));
    expect(html).toContain('href="/social?feed=discover&amp;tag=quietpint"');
    expect(html).toContain('href="/social?feed=discover&amp;tag=sunday_roast"');
    expect(html).toMatch(/<a [^>]*tag=quietpint[^>]*>#quietpint<\/a>/);
    expect(html).not.toMatch(/<span>#quietpint<\/span>/);
    // The author link the card already had is still there.
    expect(html).toContain('href="/u/alice"');
  });
});

describe("the tag in the Social address", () => {
  it("normalises the way the composer stores a tag", () => {
    expect(normalizeSocialHashtag("#Camden")).toBe("camden");
    expect(normalizeSocialHashtag(" SUNDAY_roast ")).toBe("sunday_roast");
    expect(normalizeSocialHashtag("two words")).toBeNull();
    expect(normalizeSocialHashtag("")).toBeNull();
  });

  it("reads a tag on Across town only, and carries it to the feed request", () => {
    const state = parseSocialShellSearch("feed=discover&tag=%23Camden");
    expect(state).toMatchObject({ valid: true, tab: "posts", feed: "discover", tag: "camden" });
    expect(socialFeedRequestHref(state)).toBe("/api/social/posts?lane=discover&tag=camden&limit=20");
    expect(parseSocialShellSearch("feed=nearby&tag=camden").valid).toBe(false);
    expect(parseSocialShellSearch("tag=camden").valid).toBe(false);
    expect(parseSocialShellSearch("feed=discover&tag=no%20way").valid).toBe(false);
  });

  it("builds the card's link from the same rule", () => {
    expect(socialTagHref("quietpint")).toBe("/social?feed=discover&tag=quietpint");
  });
});
