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
const loadedPrivateTools = vi.hoisted(() => ({ composer: 0, outbox: 0, tags: 0, ranking: 0, crews: 0 }));

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
vi.mock("@/components/social/CrewsPanel", () => { loadedPrivateTools.crews++; return { default: () => null }; });
vi.mock("@/components/social/PubRankingPanel", () => { loadedPrivateTools.ranking++; return { default: () => null }; });
vi.mock("@/components/social/CreatorListsLane", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/components/social/StarterPacks", () => ({ default: () => null }));
vi.mock("@/components/social/FindYourLot", () => ({ default: () => null }));
vi.mock("@/components/founding/FoundersWallLink", () => ({ default: () => null }));
vi.mock("@/app/discover/DiscoverPageClient", () => ({ DiscoverBody: () => null }));
vi.mock("@/app/social/SocialComposer", () => { loadedPrivateTools.composer++; return { default: () => createElement("p", null, "composer") }; });
vi.mock("@/app/social/SocialOutbox", () => { loadedPrivateTools.outbox++; return { default: () => null }; });
vi.mock("@/app/social/SocialTagInbox", () => { loadedPrivateTools.tags++; return { default: () => null }; });

import { buildOptimisticSpillDrop, buildOptimisticSpillRetryPayload, createOptimisticSpillPhotoPreview, revokeOptimisticSpillPhotoPreview, failOptimisticSpill, readOptimisticSpills, upsertOptimisticSpill, writeOptimisticSpills } from "@/lib/optimisticSpillPost";
import SocialPageClient from "@/app/social/SocialPageClient";
import { SOCIAL_SIGN_IN_HREF } from "@/components/social/SocialViewerState";
import { SOCIAL_LONDON_LANE_COPY, SOCIAL_LONDON_LANE_SEEN_KEY } from "@/lib/socialLondonLane";
import type { SocialAlternatives } from "@/lib/socialAlternatives";
import { namedRoutePath } from "@/lib/namedRoutes";

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
const ALTERNATIVES = {
  crawls: [{ name: "Victorian Soho", href: namedRoutePath("victorian-soho"), stops: 5 }],
  prices: [{
    venueId: "venue-lamb", name: "The Lamb", href: "/map?sel=venue-lamb", drink: "House lager",
    serving: "a pint", priceGbp: 5.5, publisher: { label: "The Lamb", url: "https://lamb.example/menu" },
    observedOn: "2026-10-30",
  }],
  priceRead: "ready",
} as const;
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
  localStorage.setItem(SOCIAL_LONDON_LANE_SEEN_KEY, "1");
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

async function renderSocial(londonLaneOpen: boolean, publicAlternatives?: SocialAlternatives): Promise<void> {
  await act(async () => {
    root.render(createElement(SocialPageClient, {
      initialState: posts,
      friendsLaunchEnabled: true,
      londonLaneOpen,
      rivalry: [],
      heritageCrawls: [],
      publicAlternatives,
    }));
  });
  // Let the lane's read settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("/social signed out, London lane open", () => {
  it("shows the public lane without loading private posting tools", async () => {
    await renderSocial(true);
    expect(host.textContent).toContain("Proper pint at the Lamb");
    expect(loadedPrivateTools).toEqual({ composer: 0, outbox: 0, tags: 0, ranking: 0, crews: 0 });
  });
  it("puts real crawls, dated prices and a plan action before the empty lane's sign-in offer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ posts: [], nextCursor: null })));
    await renderSocial(true, ALTERNATIVES);
    const offer = host.querySelector(".socialEmptySignIn a");
    expect(offer?.getAttribute("href")).toBe(SOCIAL_SIGN_IN_HREF);
    for (const href of ["/routes/victorian-soho", "/map?sel=venue-lamb", "/plan"]) {
      const choice = host.querySelector(`a[href='${href}']`);
      expect(choice, href).not.toBeNull();
      expect(choice!.compareDocumentPosition(offer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(host.textContent).toContain("Latest pint prices we hold");
    expect(host.textContent).toContain("a pint");
    expect(host.querySelector("a[href='https://lamb.example/menu']")?.textContent).toBe("The Lamb");
    expect(host.querySelector("time[dateTime='2026-10-30']")).not.toBeNull();
    expect(host.querySelector("[data-primary-action] a")?.textContent).toBe("Plan a night");
  });

  it("keeps the loading sign-in link in place while it holds focus", async () => {
    let answer!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
    await renderSocial(true, ALTERNATIVES);
    const original = host.querySelector<HTMLAnchorElement>("[data-primary-action] a")!;
    expect(original.textContent).toBe("Sign in");
    expect(host.querySelector(".socialLondonEmpty")).toBeNull();
    await act(async () => { original.focus(); });
    await act(async () => {
      answer(Response.json({ posts: [], nextCursor: null }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(original);
    expect(original.getAttribute("href")).toBe(SOCIAL_SIGN_IN_HREF);
    expect(original.textContent).toBe("Sign in");
    expect(host.querySelector(".socialEmptySignIn")).toBeNull();
    await act(async () => { host.querySelector<HTMLAnchorElement>(".socialSwitcher a")!.focus(); });
    expect(host.querySelector("[data-primary-action] a")?.textContent).toBe("Plan a night");
    expect(host.querySelector(".socialEmptySignIn a")).not.toBeNull();
  });

  it.each(["ready", "unavailable"] as const)("keeps a real browse action when the price read is %s and has no eligible rows", async (priceRead) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ posts: [], nextCursor: null })));
    await renderSocial(true, { ...ALTERNATIVES, prices: [], priceRead });
    const text = host.querySelector(".socialLondonEmpty")?.textContent ?? "";
    expect(text).toContain(priceRead === "ready" ? "No dated menu prices to show here yet." : "We could not read the listed prices.");
    expect(host.querySelector(".socialAlternativeBrowse")?.getAttribute("href")).toBe("/pubs");
    expect(host.querySelector(".socialEmptySignIn a")).not.toBeNull();
  });

  it("does not call a page with a continuation cursor an empty London feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ posts: [], nextCursor: "next-page" })));
    await renderSocial(true, ALTERNATIVES);
    expect(host.querySelector(".socialLondonEmpty")).toBeNull();
    expect(host.querySelector(".socialEmptySignIn")).toBeNull();
    expect(host.querySelector("[data-primary-action] a")?.textContent).toBe("Sign in");
    expect(host.querySelector(".socialLondonMore")).not.toBeNull();
  });


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

  it("offers one quiet log line on a first visit, then the empty lane next time", async () => {
    localStorage.removeItem(SOCIAL_LONDON_LANE_SEEN_KEY);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ posts: [], nextCursor: null })));
    await renderSocial(true, ALTERNATIVES);
    const line = host.querySelector("a[href='/map?log=1']");
    expect(line?.textContent).toBe(SOCIAL_LONDON_LANE_COPY.firstVisit);
    expect(host.textContent).not.toContain(SOCIAL_LONDON_LANE_COPY.emptyTitle);
    expect(host.textContent).not.toContain("Latest pint prices we hold");
    expect(host.querySelector(".socialLondonEmpty")).toBeNull();
    expect(localStorage.getItem(SOCIAL_LONDON_LANE_SEEN_KEY)).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    await renderSocial(true, ALTERNATIVES);
    expect(host.textContent).toContain(SOCIAL_LONDON_LANE_COPY.emptyTitle);
    expect(host.textContent).toContain("Latest pint prices we hold");
    expect(host.querySelector("a[href='/map?log=1']")).toBeNull();
  });

  it("shows posts on a first visit and remembers that the lane was seen", async () => {
    localStorage.removeItem(SOCIAL_LONDON_LANE_SEEN_KEY);
    await renderSocial(true);
    expect(host.textContent).toContain("Proper pint at the Lamb");
    expect(host.textContent).not.toContain(SOCIAL_LONDON_LANE_COPY.firstVisit);
    expect(localStorage.getItem(SOCIAL_LONDON_LANE_SEEN_KEY)).not.toBeNull();
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

// Issue 2721 requires recovery through the canonical Social surface. A hidden
// legacy Feed handler cannot satisfy this contract, even if its unit tests pass.
it("recovers a stored Pint Drop on Social with its bill and a stable replacement key", async () => {
  localStorage.clear();
  setSession("signed-in");
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: () => "blob:social-bill",
    revokeObjectURL: vi.fn(),
  }));
  const billUrl = createOptimisticSpillPhotoPreview(new Blob(["bill"], { type: "image/jpeg" }));
  const input = {
    clientRequestId: "lost-drop", venueId: "venue-lamb", venueName: "The Lamb", handle: "alice",
    priceGbp: "5.50", drink: "Pale ale", passedDownNote: "", era: "", visibility: "public" as const,
    vibeTags: [], pintPhotoUrl: null, venuePhotoUrl: null,
    receiptPhotoUrl: billUrl, measure: "pint" as const, measureLabel: "",
    createdAt: new Date().toISOString(),
  };
  writeOptimisticSpills(localStorage, failOptimisticSpill(
    upsertOptimisticSpill([], buildOptimisticSpillDrop(input), buildOptimisticSpillRetryPayload(input)),
    input.clientRequestId, "Connection lost",
  ));
  const otherInput = { ...input, clientRequestId: "other-account", handle: "bob", venueName: "Other account pub" };
  writeOptimisticSpills(localStorage, [
    ...readOptimisticSpills(localStorage),
    ...failOptimisticSpill(upsertOptimisticSpill([], buildOptimisticSpillDrop(otherInput), buildOptimisticSpillRetryPayload(otherInput)), "other-account", "Offline"),
  ]);
  const requests: FormData[] = [];
  transport.request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/social/access") return Response.json({ state: "verified", viewerHandle: "alice" });
    if (url === "/api/pint-drops" && init?.method === "POST") {
      requests.push(init.body as FormData);
      if (requests.length === 1) return Response.json({ code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
      if (requests.length === 2) throw new Error("Connection lost again");
      return Response.json({ drop: { ...buildOptimisticSpillDrop(input), id: "saved-drop", optimistic: undefined } });
    }
    return Response.json({ posts: [], items: [], nextCursor: null });
  });
  await renderSocial(true);
  const recovery = () => host.querySelector('section[aria-label="Unsent Pint Drops"]');
  expect(recovery()?.textContent).toContain("The Lamb");
  expect(recovery()?.textContent).not.toContain("Other account pub");
  const retry = async () => {
    const button = recovery()?.querySelector("button");
    expect(button).not.toBeNull();
    await act(async () => button!.click());
  };
  await retry();
  expect(requests[0]!.get("clientRequestId")).toBe("lost-drop");
  const freshKey = readOptimisticSpills(localStorage)[0]!.retry!.clientRequestId;
  expect(freshKey).toEqual(expect.any(String));
  expect(freshKey).not.toBe("lost-drop");
  await retry();
  expect(requests[1]!.get("clientRequestId")).toBe(freshKey);
  expect(requests[1]!.get("receipt_photo")).toBeInstanceOf(Blob);
  await retry();
  expect(requests[2]!.get("clientRequestId")).toBe(freshKey);
  expect(requests[2]!.get("receipt_photo")).toBeInstanceOf(Blob);
  expect(readOptimisticSpills(localStorage)[0]!.drop.id).toBe("saved-drop");
  expect(recovery()).toBeNull();
  revokeOptimisticSpillPhotoPreview(billUrl);
  localStorage.clear();
});
