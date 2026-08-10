// The two reading surfaces of a rich profile: the stranger's card and the
// owner's composer. The card prints only what its owner filled in, wears a
// cover when one was approved and the brass treatment when none was, and never
// invents a line. The composer asks for the same things in three groups, so
// eight inputs read as an identity rather than a settings page.

import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => null }));

import ProfileEditor from "@/components/profile/ProfileEditor";
import ProfileHeader from "@/components/profile/ProfileHeader";
import type { Profile, ProfileStats } from "@/lib/profiles";

const STATS: ProfileStats = {
  pintsLogged: 3,
  cheapestPintGbp: 4.8,
  crawlsPosted: 0,
  memoriesPosted: 0,
};

function header(profile: Partial<Profile>): string {
  return renderToStaticMarkup(
    createElement(ProfileHeader, {
      profile: { handle: "alice", displayName: "Alice Fennimore", ...profile },
      stats: STATS,
    }),
  );
}

function editor(initial: Record<string, string> = {}): string {
  return renderToStaticMarkup(
    createElement(ProfileEditor, {
      handle: "alice",
      initial,
      onSaved: () => {},
      onProfileChanged: () => {},
      onClose: () => {},
    }),
  );
}

describe("public profile card", () => {
  it("prints the card facts its owner filled in, with their own labels", () => {
    const markup = header({
      favouriteDrink: "Guinness",
      interests: "Quiz nights and back-room jazz",
      workplace: "Hackney Bridge Studios",
    });

    expect(markup).toContain("profileCardFacts");
    expect(markup).toContain("Drinks");
    expect(markup).toContain("Guinness");
    expect(markup).toContain("Into");
    expect(markup).toContain("Quiz nights and back-room jazz");
    expect(markup).toContain("Works at");
    expect(markup).toContain("Hackney Bridge Studios");
  });

  it("says nothing at all when a profile filled nothing in", () => {
    const markup = header({});
    expect(markup).not.toContain("profileCardFacts");
    expect(markup).not.toContain("Drinks");
    expect(markup).not.toContain("Works at");
  });

  it("omits one absent fact rather than printing an empty label", () => {
    const markup = header({ favouriteDrink: "Cider", workplace: "   " });
    expect(markup).toContain("Drinks");
    expect(markup).not.toContain("Works at");
  });

  it("wears an approved cover as the header backdrop", () => {
    const markup = header({ coverUrl: "/api/cover/profile-1/generation-1" });
    expect(markup).toContain("profileHeaderWithCover");
    expect(markup).toContain("profileCoverImage");
    expect(markup).toContain("/api/cover/profile-1/generation-1");
    // The falloff is what keeps the name legible over a photograph.
    expect(markup).toContain("profileCoverFalloff");
  });

  it("keeps the brass treatment when no cover was approved", () => {
    const markup = header({});
    expect(markup).toContain("profileCover");
    expect(markup).not.toContain("profileHeaderWithCover");
    expect(markup).not.toContain("profileCoverImage");
  });

  it("never prints a storage key or a moderation state", () => {
    const markup = header({
      coverUrl: "/api/cover/profile-1/generation-1",
      avatarUrl: "/api/avatar/profile-1/generation-1",
    });
    expect(markup).not.toContain("covers/");
    expect(markup).not.toContain("avatars/");
    expect(markup).not.toContain("staging.jpg");
    expect(markup).not.toContain("approved");
  });
});

describe("profile composer", () => {
  it("groups the questions instead of stacking eight inputs", () => {
    const markup = editor();
    expect(markup).toContain("Your look");
    expect(markup).toContain("You</legend>");
    expect(markup).toContain("Your night");
    expect(markup.match(/<fieldset/g) ?? []).toHaveLength(3);
  });

  it("asks for the cover, the photo, the name and every card field", () => {
    const markup = editor();
    for (const label of [
      "Cover photo",
      "Profile photo",
      "Display name",
      "Bio",
      "Home city",
      "Favourite drink",
      "What you&#x27;re into",
      "Where you work",
    ]) {
      expect(markup).toContain(label);
    }
  });

  it("offers drink suggestions from the drink taxonomy without closing the field", () => {
    const markup = editor();
    expect(markup).toContain('list="pe-drink-suggestions"');
    expect(markup).toContain("<datalist");
    expect(markup).toContain('value="Beer"');
    // `other` names no drink, so it is not a suggestion.
    expect(markup).not.toContain('value="Other"');
    // The field itself stays free text: no select, no closed set.
    expect(markup).not.toContain("<select");
  });

  it("pre-fills from the stored row and keeps Save and Cancel explicit", () => {
    const markup = editor({
      displayName: "Alice Fennimore",
      favouriteDrink: "Guinness",
      workplace: "Hackney Bridge Studios",
    });
    expect(markup).toContain('value="Alice Fennimore"');
    expect(markup).toContain('value="Guinness"');
    expect(markup).toContain('value="Hackney Bridge Studios"');
    expect(markup).toContain("Save profile");
    expect(markup).toContain("Cancel");
  });

  it("offers removal only for a slot that already holds an image", () => {
    expect(editor()).not.toContain("Remove photo");
    expect(editor({ avatarUrl: "/api/avatar/p/g" })).toContain("Remove photo");
  });

  // The backdrop is a rotation of up to five, so the composer owns a LIST
  // rather than one slot. There is exactly one cover control on the page: two
  // live copies of the same choice drift the moment either one writes.
  it("gives the covers one list control and no second single-cover slot", () => {
    const markup = editor({ coverUrl: "/api/cover/p/g" });
    expect(markup).toContain("Cover photos");
    expect(markup).toContain("Add cover");
    expect(markup).not.toContain("Choose cover");
    expect(markup).not.toContain("Remove cover");
  });
});

describe("shipped profile CSS", () => {
  const css = readFileSync(join(process.cwd(), "app/u/[handle]/profile.css"), "utf8");

  it("keeps the cover behind a falloff so the name stays legible", () => {
    expect(css).toContain(".profilePage .profileCover {");
    expect(css).toContain(".profilePage .profileCoverFalloff {");
    expect(css).toMatch(/profileCoverFalloff \{[^}]*linear-gradient/);
  });

  it("gives the face its own edge over the band, and hangs it over the edge", () => {
    // The band is painted on every profile now, photograph or brass wash, so
    // the ring is unconditional rather than a with-cover special case.
    expect(css).toMatch(
      /\.profilePage \.profileAvatar \{[^}]*border: 4px solid var\(--panel-raised\)/,
    );
    expect(css).toMatch(
      /\.profilePage \.profileIdentity \{[^}]*margin-top: calc\(-1 \* var\(--profile-avatar-overlap\)\)/,
    );
  });

  // What an owner framed in the cropper is what a reader sees. A band with a
  // fixed height over a fluid width shows a different rectangle at every
  // viewport, which is how a carefully framed photograph got cut mid-word.
  it("renders a cover at the cropper's own aspect ratio", () => {
    expect(css).toMatch(
      /\.profilePage \.profileHeaderWithCover \.profileCover \{[^}]*aspect-ratio: 3 \/ 1/,
    );
    // The brass wash has no photograph to crop, so it takes a shorter band
    // rather than four hundred pixels of gradient above the fold.
    expect(css).toMatch(/\.profilePage \.profileCover \{[^}]*height: clamp\(116px/);
  });

  // The rotation crossfades only for a reader who did not ask for less motion;
  // the component refuses to run its timer under the same condition.
  it("gates the crossfade on prefers-reduced-motion", () => {
    const gated = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(gated).toMatch(/\.profileCoverImage \{[^}]*transition: opacity/);
    expect(css.slice(0, css.indexOf("@media (prefers-reduced-motion"))).not.toMatch(
      /\.profileCoverImage \{[^}]*transition/,
    );
  });

  it("wraps a card fact rather than truncating what somebody wrote", () => {
    expect(css).toMatch(/profileCardFact dd \{[^}]*overflow-wrap: anywhere/);
    expect(css).not.toMatch(/profileCardFact dd \{[^}]*text-overflow: ellipsis/);
  });

  it("leaves press feedback to the one owner in globals.css", () => {
    // app/globals.css scales every button on :active behind the reduced-motion
    // gate. A second scale here would be a second owner of the same moment.
    expect(css).not.toMatch(/profileEditor[A-Za-z]*:active/);
  });
});
