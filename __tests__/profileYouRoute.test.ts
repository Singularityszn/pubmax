import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/profile/PubmaxxAccountHub", () => ({
  default: () => createElement("div", null, "account hub"),
}));
vi.mock("@/components/wanted/WantedList", () => ({
  default: () => createElement("div", null, "wanted list"),
}));

import {
  ProfileFollowBoundary,
  profileSocialDataForLaunch,
  profileSurfaceFor,
  YouSignedOutSurface,
} from "@/app/u/[handle]/ProfilePageClient";
import ProfilePeoplePage, {
  generateMetadata as peopleMetadata,
} from "@/app/u/[handle]/people/[relation]/page";

/** The redirect target Next carries on the error `redirect()` throws, or null. */
async function redirectTarget(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) throw error;
    return digest.split(";")[2] ?? null;
  }
}

describe("signed-out /u/you surface", () => {
  it("shows a sign-in boundary instead of an unusable Follow button", () => {
    const html = renderToStaticMarkup(createElement(ProfileFollowBoundary, {
      friendsLaunchEnabled: true,
      isAnonymous: true,
      routeHandle: "alice",
      viewerHandle: "",
      following: false,
      followsViewer: false,
      onCountsChange: () => undefined,
    }));

    expect(html).toContain("Sign in to follow");
    expect(html).toContain("/login?mode=signin&amp;from=%2Fu%2Falice");
    expect(html).not.toContain("followBtn");
  });

  it("removes cached Social state during rollback", () => {
    const data = {
      socialLinks: [{
        provider: "website" as const,
        label: "Website",
        mark: "WW",
        username: "example.test",
        profileUrl: "https://example.test/",
      }],
      counts: { followers: 4, following: 2 },
      following: true,
      followsViewer: true,
    };

    expect(profileSocialDataForLaunch(false, data)).toEqual({
      socialLinks: [],
      counts: null,
      following: false,
      followsViewer: false,
    });
    expect(profileSocialDataForLaunch(true, data)).toBe(data);
  });

  it("keeps the account invitation ahead of a failed public read", () => {
    const surface = profileSurfaceFor({
      routeHandle: "you",
      identityResolved: true,
      hasUser: false,
      viewerHandle: "",
      state: "error",
    });
    const html = renderToStaticMarkup(
      createElement(YouSignedOutSurface, { nightMemoriesInvite: false }),
    );

    expect(surface).toBe("you-invitation");
    expect(html).toContain("Claim your @handle.");
    expect(html).toContain("With a handle you can:");
    // One invitation and a short list, never a tour of features the reader
    // does not have yet.
    expect(html.match(/<li>/g) ?? []).toHaveLength(4);
    expect(html).not.toMatch(/Wanted|Step Out|Night Memor/);
    expect(html).not.toContain("@you");
    expect(html).not.toContain("Couldn&#x27;t load pints");
    expect(html).not.toContain("profileErrorState");
  });
});

describe("the people pages under /u", () => {
  it("sends the /u/you sentinel back to the You door", async () => {
    for (const relation of ["followers", "following"]) {
      const target = await redirectTarget(() =>
        ProfilePeoplePage({ params: Promise.resolve({ handle: "you", relation }) }),
      );
      expect(target).toBe("/u/you");
    }
  });

  it("keeps every people list out of search", async () => {
    for (const handle of ["you", "handle", "alice"]) {
      const metadata = await peopleMetadata({
        params: Promise.resolve({ handle, relation: "followers" }),
      });
      expect(metadata.robots).toEqual({ index: false, follow: false });
      expect(metadata.alternates?.canonical).toBeUndefined();
    }
  });
});
