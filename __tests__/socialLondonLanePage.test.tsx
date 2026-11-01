// @vitest-environment jsdom

// /social SIGNED OUT, with the London lane open (captain decision 7, 1 Nov
// 2026). A stranger reads public London posts and does nothing else: no
// composer, no cheer or comment row, one quiet sign-in line per card where that
// row would be, and the Screen's door stays the page's ONE filled action.

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerSession } from "@/components/auth/useViewerSession";

const viewer = vi.hoisted(() => ({
  auth: { accountRevision: 0, identityResolved: true, user: null as { id: string } | null },
  session: {} as ViewerSession,
}));
const transport = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...props }: { href: string; children?: ReactNode; prefetch?: boolean }) => {
    const domProps = { ...props };
    delete domProps.prefetch;
    return createElement("a", { href, ...domProps }, children);
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => viewer.auth }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => viewer.session }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => null }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: transport.request, authedFetch: transport.request }));
vi.mock("@/lib/deviceAccountIdentity", () => ({ subscribeDeviceIdentity: () => () => undefined }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/profile/HandleAvatar", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => null }));
vi.mock("@/components/social/CreatorListsLane", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/components/social/StarterPacks", () => ({ default: () => null }));
vi.mock("@/components/social/FindYourLot", () => ({ default: () => null }));
vi.mock("@/components/founding/FoundersWallLink", () => ({ default: () => null }));
vi.mock("@/app/discover/DiscoverPageClient", () => ({ DiscoverBody: () => null }));
vi.mock("@/app/social/SocialComposer", () => ({ default: () => createElement("p", null, "composer") }));
vi.mock("@/app/social/SocialOutbox", () => ({ default: () => null }));
vi.mock("@/app/social/SocialTagInbox", () => ({ default: () => null }));

import SocialPageClient from "@/app/social/SocialPageClient";
import { SOCIAL_SIGN_IN_HREF } from "@/components/social/SocialViewerState";
import { SOCIAL_LONDON_LANE_COPY } from "@/lib/socialLondonLane";

const LANE_PAGE = {
  posts: [
    {
      id: "post-photo",
      kind: "standard",
      visibility: "public",
      body: "Proper pint at the Lamb",
      area: "camden",
      hashtags: ["roast"],
      photo: { mediaId: "11111111-1111-4111-8111-111111111111", altText: "A pint on the bar", tags: [{ handle: "bob" }] },
      nameHidden: false,
      author: { handle: "alice" },
      createdAt: "2026-11-01T19:00:00.000Z",
      editedAt: null,
    },
    {
      id: "post-hidden",
      kind: "standard",
      visibility: "public",
      body: "Quiet one in Clapham",
      area: "clapham",
      hashtags: [],
      photo: null,
      nameHidden: true,
      author: { handle: null },
      createdAt: "2026-11-01T18:00:00.000Z",
      editedAt: null,
    },
  ],
  nextCursor: null,
};

const posts = { valid: true as const, tab: "posts" as const, feed: "following" as const, area: null };
let host: HTMLDivElement;
let root: Root;
let laneRequests: Array<{ url: string; init: RequestInit | undefined }>;

function setSession(phase: ViewerSession["phase"]): void {
  viewer.session = {
    phase,
    signedIn: phase === "signed-in",
    signedOut: phase === "signed-out",
    unresolved: phase === "unresolved",
  };
  viewer.auth.identityResolved = phase !== "unresolved";
  viewer.auth.user = phase === "signed-in" ? { id: "user-a" } : null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setSession("signed-out");
  laneRequests = [];
  transport.request.mockReset();
  transport.request.mockImplementation(async (input: RequestInfo | URL) => {
    throw new Error(`Unexpected signed-in request: ${String(input)}`);
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("/api/social/posts?lane=london")) throw new Error(`Unexpected request: ${url}`);
    laneRequests.push({ url, init });
    return new Response(JSON.stringify(LANE_PAGE), { status: 200, headers: { "content-type": "application/json" } });
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function renderSocial(londonLaneOpen: boolean): Promise<void> {
  await act(async () => {
    root.render(createElement(SocialPageClient, {
      initialState: posts,
      friendsLaunchEnabled: true,
      londonLaneOpen,
      rivalry: [],
      heritageCrawls: [],
    }));
  });
  // Let the lane's read settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("/social signed out, London lane open", () => {
  it("reads the lane with no credentials and renders its posts read-only", async () => {
    await renderSocial(true);

    expect(laneRequests).toHaveLength(1);
    expect(laneRequests[0]!.url).toBe("/api/social/posts?lane=london&limit=20");
    expect(laneRequests[0]!.init).toMatchObject({ cache: "no-store", credentials: "omit" });
    expect(transport.request).not.toHaveBeenCalled();

    const lane = host.querySelector('section[aria-labelledby="social-london-lane-title"]')!;
    expect(lane).not.toBeNull();
    expect(lane.querySelector("h2")?.textContent).toBe(SOCIAL_LONDON_LANE_COPY.title);
    const cards = [...lane.querySelectorAll("article.socialPostCard")];
    expect(cards.map((card) => card.querySelector(".socialPostBody")?.textContent)).toEqual([
      "Proper pint at the Lamb",
      "Quiet one in Clapham",
    ]);
    // The photo comes through the media route, with its consented tag.
    expect(cards[0]!.querySelector("img")?.getAttribute("src")).toBe("/api/social/media/11111111-1111-4111-8111-111111111111");
    expect(cards[0]!.querySelector("figcaption")?.textContent).toBe("@bob");
    // A hidden-name post names nobody.
    expect(cards[1]!.textContent).toContain("a PUBMAXXER");
    expect(cards[1]!.querySelector('a[href^="/u/"]')).toBeNull();
  });

  it("puts one quiet sign-in line where each card's cheer and comment row would be", async () => {
    await renderSocial(true);
    const cards = [...host.querySelectorAll("article.socialPostCard")];
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.querySelector(".socialPostActions"), "no cheer, comment, save or report row").toBeNull();
      expect(card.querySelectorAll("button")).toHaveLength(0);
      const prompts = card.querySelectorAll(".socialPostSignIn a");
      expect(prompts).toHaveLength(1);
      expect(prompts[0]!.textContent).toBe(SOCIAL_LONDON_LANE_COPY.signIn);
      expect(prompts[0]!.getAttribute("href")).toBe(SOCIAL_SIGN_IN_HREF);
    }
    // A hashtag is a word here: the lane it leads to needs an account.
    expect(cards[0]!.querySelector(".socialPostTags a")).toBeNull();
    expect(cards[0]!.querySelector(".socialPostTags")?.textContent).toBe("#roast");
  });

  it("keeps the Screen's door as the one filled action and offers no composer", async () => {
    await renderSocial(true);
    const primaries = host.querySelectorAll("[data-primary-action]");
    expect(primaries).toHaveLength(1);
    const door = primaries[0]!.querySelector("a");
    expect(door?.textContent).toBe("Sign in");
    expect(door?.getAttribute("href")).toBe(SOCIAL_SIGN_IN_HREF);
    expect(host.textContent).not.toContain("composer");
    expect(host.querySelector(".socialButton")).toBeNull();
    // The lane replaces the old wall: it no longer says Social is closed to them.
    expect(host.textContent).not.toContain("Sign in to use Social.");
  });

  it("says so honestly when the lane is empty or unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ posts: [], nextCursor: null }), { status: 200 })));
    await renderSocial(true);
    expect(host.textContent).toContain(SOCIAL_LONDON_LANE_COPY.emptyTitle);
    await act(async () => root.unmount());
    root = createRoot(host);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "SOCIAL_LANE_PAUSED" }, { status: 503 })));
    await renderSocial(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(SOCIAL_LONDON_LANE_COPY.unavailable);
    expect(host.querySelectorAll("[data-primary-action]")).toHaveLength(1);
  });
});

describe("/social signed out, London lane paused", () => {
  it("shows the sign-in door and asks for no posts", async () => {
    await renderSocial(false);
    expect(laneRequests).toEqual([]);
    expect(host.querySelector('section[aria-labelledby="social-london-lane-title"]')).toBeNull();
    expect(host.textContent).toContain("Sign in to use Social.");
    expect(host.querySelectorAll("[data-primary-action]")).toHaveLength(1);
  });
});

describe("/social while the session is still answering", () => {
  it("does not show a stranger's lane to somebody who may be signed in", async () => {
    setSession("unresolved");
    await renderSocial(true);
    expect(laneRequests).toEqual([]);
    expect(host.querySelector('section[aria-labelledby="social-london-lane-title"]')).toBeNull();
  });
});
