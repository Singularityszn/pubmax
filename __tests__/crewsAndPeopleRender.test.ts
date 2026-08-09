// What the new surfaces render, and what they refuse to render.
//
// Three separate promises are pinned here:
//  1. Crews are behind the Social gate. With PUBMAX_SOCIAL_FRIENDS_LAUNCH off,
//     nothing user-reachable about a crew may exist on any page.
//  2. The follow control says where a friendship stands, so "Mates" and
//     "Following" are never the same pixels.
//  3. A profile statistic is a way in, not a number in a box.

import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authedFetch", () => ({
  authedFetch: async () => new Response("{}", { status: 403 }),
}));

import CrewsPanel from "@/components/social/CrewsPanel";
import FollowButton from "@/components/profile/FollowButton";
import ProfileHeader from "@/components/profile/ProfileHeader";
import type { Profile, ProfileStats } from "@/lib/profiles";

const socialPageClient = readFileSync(
  join(process.cwd(), "app/social/SocialPageClient.tsx"),
  "utf8",
);
const profileClient = readFileSync(
  join(process.cwd(), "app/u/[handle]/ProfilePageClient.tsx"),
  "utf8",
);

describe("crews stay behind the Social gate", () => {
  it("renders nothing at all while the panel resolves access for itself", () => {
    expect(
      renderToStaticMarkup(createElement(CrewsPanel, { resolveAccess: true })),
    ).toBe("");
  });

  it("mounts on /social only inside the verified branch", () => {
    // showPostsControls is `isPosts && access === "verified"`, the same guard
    // the composer sits behind. The ungated FindYourLot branch must never gain
    // a crew.
    expect(socialPageClient).toMatch(
      /showPostsControls \? \(\s*<CrewsPanel/,
    );
    const ungated = socialPageClient.match(
      /aria-label="Find your lot"[\s\S]*?<\/section>/,
    )?.[0];
    expect(ungated, "ungated find-your-lot branch present").toBeTruthy();
    expect(ungated).not.toMatch(/CrewsPanel/);
  });

  it("asks the gate itself wherever no parent already did", () => {
    expect(profileClient).toMatch(/<CrewsPanel[\s\S]{0,120}resolveAccess/);
  });

  it("reads the launch flag through Social access, never through the browser", () => {
    // Code only. A comment may name the flag to explain the rule; the same
    // split the we-are-out fence uses.
    const code = (source: string) =>
      source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");
    for (const source of [
      readFileSync(join(process.cwd(), "components/social/CrewsPanel.tsx"), "utf8"),
      readFileSync(
        join(process.cwd(), "app/social/crews/[crewId]/CrewDetailClient.tsx"),
        "utf8",
      ),
    ]) {
      expect(code(source)).not.toMatch(/process\.env/);
      expect(code(source)).not.toMatch(/PUBMAX_SOCIAL_FRIENDS_LAUNCH/);
      expect(source).not.toContain("—");
    }
  });
});

describe("the follow control says where the friendship stands", () => {
  function markup(props: {
    initialFollowing: boolean;
    followsViewer?: boolean;
  }): string {
    return renderToStaticMarkup(
      createElement(FollowButton, {
        targetHandle: "sam",
        followerHandle: "alice",
        ...props,
      }),
    );
  }

  it("calls a two-sided follow Mates, and says so", () => {
    const html = markup({ initialFollowing: true, followsViewer: true });
    expect(html).toContain("Mates");
    expect(html).toContain("You follow each other");
  });

  it("keeps a one-sided follow honestly one-sided", () => {
    const html = markup({ initialFollowing: true, followsViewer: false });
    expect(html).toContain("Following");
    expect(html).not.toContain("Mates");
    expect(html).toMatch(/not followed back/);
  });

  it("shows a pending mate the follow-back move and names the hint", () => {
    const html = markup({ initialFollowing: false, followsViewer: true });
    expect(html).toContain("Follow back");
    expect(html).toContain("Follows you");
  });

  it("says nothing extra when there is no edge either way", () => {
    const html = markup({ initialFollowing: false });
    expect(html).toContain(">Follow<");
    expect(html).not.toContain("Follows you");
    expect(html).not.toContain("Mates");
  });

  it("carries what the tap does in the accessible name", () => {
    expect(markup({ initialFollowing: true, followsViewer: true })).toMatch(
      /aria-label="[^"]*no longer be mates/,
    );
  });

  it("still defaults to the old one-edge behaviour when nobody passes the mirror", () => {
    // The prop is optional so every existing caller keeps compiling; the
    // default must be the cautious one, never a claimed mutual.
    expect(markup({ initialFollowing: true })).not.toContain("Mates");
  });
});

describe("profile statistics are ways in", () => {
  const profile: Profile = {
    handle: "sam",
    displayName: "Sam",
    homeCity: "London",
    bio: "",
    avatarUrl: "",
    coverUrl: "",
  } as Profile;

  const stats: ProfileStats = {
    pintsLogged: 12,
    cheapestPintGbp: 4.2,
    pubsVisited: 5,
    boroughs: [],
    beers: 3,
  } as unknown as ProfileStats;

  const html = renderToStaticMarkup(
    createElement(ProfileHeader, {
      profile,
      stats,
      followers: 14,
      following: 9,
      crawls: 3,
      memories: 2,
    }),
  );

  it("links every one of the six tiles", () => {
    const grid = html.match(/profileStats[\s\S]*?<\/dl>/)?.[0] ?? "";
    const tiles = grid.match(/class="profileStat"/g) ?? [];
    const links = grid.match(/class="profileStatLink"/g) ?? [];
    expect(tiles).toHaveLength(6);
    expect(links).toHaveLength(6);
  });

  it("points each tile at the surface that holds what it counts", () => {
    expect(html).toContain('href="/u/sam/people/followers"');
    expect(html).toContain('href="/u/sam/people/following"');
    expect(html).toContain('href="/u/sam#timeline"');
    expect(html).toContain('href="/u/sam#crawl-stories"');
    expect(html).toContain('href="/u/sam#night-memories"');
  });

  it("says where a tile goes in its accessible name, since a bare figure cannot", () => {
    expect(html).toMatch(/aria-label="Followers: 14\. See who follows this handle\."/);
    expect(html).toMatch(/aria-label="Pints logged: 12\./);
  });

  it("keeps the label and the figure as the only visible text", () => {
    expect(html).toContain("<dt>Followers</dt><dd>14</dd>");
  });
});
