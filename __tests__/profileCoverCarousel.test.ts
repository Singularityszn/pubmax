import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => null }));

import ProfileCoverCarousel from "@/components/profile/ProfileCoverCarousel";
import ProfileHeader from "@/components/profile/ProfileHeader";
import { coverCarouselRotates } from "@/lib/profileCovers";
import type { Profile, ProfileStats } from "@/lib/profiles";

const COVERS = [
  "/api/cover/p/one",
  "/api/cover/p/two",
  "/api/cover/p/three",
];

const STATS: ProfileStats = {
  pintsLogged: 3,
  cheapestPintGbp: 4.8,
  crawlsPosted: 0,
  memoriesPosted: 0,
};

function carousel(covers: readonly string[]): string {
  return renderToStaticMarkup(createElement(ProfileCoverCarousel, { covers }));
}

function header(profile: Partial<Profile>): string {
  return renderToStaticMarkup(
    createElement(ProfileHeader, {
      profile: { handle: "alice", displayName: "Alice Fennimore", ...profile },
      stats: STATS,
    }),
  );
}

describe("the cover carousel", () => {
  it("reserves one still frame without making an unsigned cover request", () => {
    const markup = carousel(COVERS);
    expect(markup).toContain('data-cover-count="1"');
    expect(markup).not.toContain(COVERS[0]);
    expect(markup).not.toContain(COVERS[1]);
    expect(markup).not.toContain(COVERS[2]);
  });

  it("marks the painted cover active, so the stack has exactly one opaque frame", () => {
    const markup = carousel(COVERS);
    expect(markup.match(/profileCoverImageActive/g) ?? []).toHaveLength(1);
  });

  it("renders nothing at all when there is no backdrop", () => {
    expect(carousel([])).toBe("");
  });

  // The predicate the component consults, on its own: no rotation for one
  // cover, and none for a reader who asked for less motion.
  it("refuses to rotate under reduced motion, at any count", () => {
    for (const count of [2, 3, 4, 5]) {
      expect(coverCarouselRotates({ count, reducedMotion: true })).toBe(false);
      expect(coverCarouselRotates({ count, reducedMotion: false })).toBe(true);
    }
  });
});

describe("the header's backdrop", () => {
  it("wears the whole rotation when one travelled", () => {
    const markup = header({ coverUrl: COVERS[0], coverUrls: COVERS });
    expect(markup).toContain("profileHeaderWithCover");
    expect(markup).toContain('data-cover-count="1"');
    expect(markup).not.toContain(COVERS[0]);
  });

  // A surface that only knows the single cover asked a narrower question, and
  // gets the answer it can use rather than a blank band.
  it("falls back to the single cover, and keeps the brass band with neither", () => {
    expect(header({ coverUrl: COVERS[0] })).toContain("profileCoverImageActive");
    expect(header({ coverUrl: COVERS[0] })).not.toContain(COVERS[0]);
    const bare = header({});
    expect(bare).toContain("profileCover");
    expect(bare).not.toContain("profileHeaderWithCover");
    expect(bare).not.toContain("profileCoverImage");
  });

  it("never prints a storage key or a moderation state", () => {
    const markup = header({ coverUrls: COVERS, avatarUrl: "/api/avatar/p/g" });
    expect(markup).not.toContain("covers/");
    expect(markup).not.toContain("staging.jpg");
    expect(markup).not.toContain("approved");
  });
});

