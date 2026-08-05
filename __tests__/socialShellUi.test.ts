import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/social",
  useRouter: () => ({ prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import {
  SocialAccessBoundary,
  SocialContextRail,
  SocialPostCard,
} from "@/app/social/SocialPageClient";
import type { SocialPostDTO } from "@/lib/socialPosts";

const protectedPost: SocialPostDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "standard",
  visibility: "friends",
  body: "A protected post body",
  area: "camden",
  venueId: "venue-a",
  hashtags: ["quietpint"],
  commentPolicy: "open",
  photo: null,
  moderationState: "approved",
  featureRequest: null,
  revision: 0,
  editedAt: null,
  createdAt: "2026-08-05T12:00:00.000Z",
  updatedAt: "2026-08-05T12:00:00.000Z",
  author: { handle: "alice" },
};

describe("Social access boundary", () => {
  it.each([
    ["preview", "Social is not open yet."],
    ["sign_in_required", "Sign in to use Social."],
    ["age_verification_required", "Adult check needed for Social."],
    ["suspended", "Social access is suspended."],
  ] as const)(
    "renders the honest %s boundary without protected metadata",
    (state, copy) => {
      const html = renderToStaticMarkup(
        createElement(SocialAccessBoundary, { state }),
      );

      expect(html).toContain(copy);
      expect(html).not.toContain(protectedPost.body);
      expect(html).not.toContain(protectedPost.author.handle);
      expect(html).not.toContain(protectedPost.id);
      expect(html).not.toContain("/api/social/posts");
      expect(html).not.toContain("href=");
    },
  );

  it("offers one explicit retry when access checks are unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(SocialAccessBoundary, {
        state: "unavailable",
        onRetry: () => undefined,
      }),
    );

    expect(html).toContain("Social is unavailable right now.");
    expect(html).toContain("Retry");
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

describe("verified Social post card", () => {
  it("renders the chronological DTO without legacy interaction controls", () => {
    const html = renderToStaticMarkup(
      createElement(SocialPostCard, { post: protectedPost }),
    );

    expect(html).toContain("@alice");
    expect(html).toContain(protectedPost.body);
    expect(html).toContain("Camden");
    expect(html).toContain("#quietpint");
    expect(html).toContain('href="/map?sel=venue-a"');
    expect(html).toContain("Open venue");
    expect(html).not.toContain("Open pub");
    expect(html).not.toContain("Cheers");
    expect(html).not.toContain("Comment");
    expect(html).not.toContain("For You");
    expect(html).not.toContain("Presence");
    expect(html).not.toContain("<button");
  });
});

describe("desktop Social rail", () => {
  it("preserves layout without policy helper copy", () => {
    const html = renderToStaticMarkup(
      createElement(SocialContextRail, { status: "loading" }),
    );

    expect(html).toContain('class="socialContextRail"');
    expect(html).toContain("Activity");
    expect(html).not.toContain("Social rules");
    expect(html).not.toContain("Newest first");
    expect(html).not.toContain("friend-gated");
  });

  it("keeps authorised Social activity inside the bounded rail", () => {
    const html = renderToStaticMarkup(
      createElement(SocialContextRail, {
        status: "ready",
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            kind: "comment",
            readAt: null,
            createdAt: "2026-08-05T19:00:00.000Z",
          },
        ],
      }),
    );

    expect(html).toContain("New comment");
    expect(html).not.toContain('href="/activity"');
    expect(html).not.toContain("Open Activity");
  });

  it.each(["unavailable", "ready"] as const)(
    "does not reserve a dead rail for %s without items",
    (status) => {
      const html = renderToStaticMarkup(
        createElement(SocialContextRail, { status, items: [] }),
      );

      expect(html).toBe("");
    },
  );
});
