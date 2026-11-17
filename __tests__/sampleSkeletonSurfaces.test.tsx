// @vitest-environment jsdom

// The surfaces that wait behind a SampleSkeleton (components/ui/sample-skeleton.tsx):
// the profile timeline, the profile header while the viewer is unresolved, and
// the Activity grid. Each draws the REAL card from sample values while it
// loads, so the wait has the answer's size, and none of them asks the server
// for a sample page on the way.

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ unresolved: true }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({
    href,
    prefetch,
    children,
    className,
  }: {
    href: string;
    prefetch?: boolean | null;
    children?: ReactNode;
    className?: string;
  }) => createElement("a", { href, className, "data-prefetch": String(prefetch) }, children),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) =>
    createElement("img", { src, alt, className }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: fetchMock,
  authedFetch: fetchMock,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    accountRevision: 0,
    handle: session.unresolved ? null : "ken",
    identityResolved: !session.unresolved,
  }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: session.unresolved ? "unresolved" : "signed-in",
    signedIn: !session.unresolved,
    signedOut: false,
    unresolved: session.unresolved,
  }),
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => createElement("nav", null, "Navigation") }));
vi.mock("@/components/profile/NextBadgeChips", () => ({ default: () => null }));

import ActivityClient from "@/app/activity/ActivityClient";
import FeedCard from "@/components/feed/FeedCard";
import ProfileHeader from "@/components/profile/ProfileHeader";
import ProfileTimeline from "@/components/profile/ProfileTimeline";
import { normalizePintDrop } from "@/lib/feed";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.unresolved = true;
  fetchMock.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Lets the 600 ms grace pass, after which the status line speaks. */
async function afterGrace(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
  });
}

function sampleOf(region: Element | null): Element | null {
  const sample = region?.firstElementChild ?? null;
  expect(sample?.className).toBe("sampleSkeletonSample");
  expect(sample?.hasAttribute("inert")).toBe(true);
  expect(sample?.getAttribute("aria-hidden")).toBe("true");
  return sample;
}

/** Every link a sample draws turns Next's on-sight prefetch off. */
function expectNoSamplePrefetch(sample: Element | null): void {
  const links = [...(sample?.querySelectorAll("a") ?? [])];
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(link.getAttribute("data-prefetch"), link.outerHTML).toBe("false");
}

describe("the profile timeline", () => {
  it("waits behind two real feed cards drawn from sample drops", async () => {
    await mount(createElement(ProfileTimeline, { drops: [], loading: true }));

    const region = host.querySelector("[data-sample-skeleton]");
    expect(region?.className).toBe("sampleSkeleton profileTimelineSkel feedList");
    expect(region?.getAttribute("aria-busy")).toBe("true");
    const sample = sampleOf(region);
    expect(sample?.querySelectorAll(":scope > article.feedCard")).toHaveLength(2);
    // The timeline's usual card is the photo Spill.
    expect(sample?.querySelectorAll(".feedSpill img.feedSpillPhoto")).toHaveLength(2);
    expectNoSamplePrefetch(sample);
    await afterGrace();
    expect(host.querySelector('p.sr-only[role="status"]')?.textContent).toBe("Loading the timeline");
  });

  it("prints no price, no pub and no person from the sample", async () => {
    await mount(createElement(ProfileTimeline, { drops: [], loading: true }));
    const text = host.textContent ?? "";
    expect(text).not.toContain("£");
    expect(host.querySelector(".priceBadge, [class*='priceBand-']")).toBeNull();
    expect(text).toContain("Pub name");
    expect(text).toContain("@handle");
  });

  it("leaves a real card's links as they were", async () => {
    const item = normalizePintDrop({
      id: "drop-1",
      handle: "ken",
      priceGbp: null,
      drink: "",
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      venueId: "venue-1",
      createdAt: "2026-10-01T12:00:00.000Z",
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      venueName: "The Real Arms",
    });
    await mount(createElement(FeedCard, { item, summary: { counts: {}, mine: [] }, onToggleReaction: () => {} }));
    const links = [...host.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute("data-prefetch")).toBe("undefined");
  });

  it("draws the wait and the answer from the same timeline component", async () => {
    await mount(createElement(ProfileTimeline, { drops: [], loading: true }));
    expect(host.querySelector("[data-sample-skeleton]")).not.toBeNull();

    await mount(
      createElement(ProfileTimeline, {
        drops: [
          {
            id: "drop-1",
            handle: "ken",
            venueId: "venue-1",
            venueName: "The Real Arms",
            createdAt: "2026-10-01T12:00:00.000Z",
            pintPhotoUrl: "/landing/pint.jpg",
          },
        ],
      }),
    );
    expect(host.querySelector("[data-sample-skeleton]")).toBeNull();
    expect(host.querySelector('p.sr-only[role="status"]')).toBeNull();
    expect(host.querySelectorAll(".profileTimeline > article.feedCard")).toHaveLength(1);
  });
});

describe("the profile header while the viewer is unresolved", () => {
  it("is the real card drawn from sample values, with no sample page prefetched", async () => {
    await mount(
      createElement(ProfileHeader, {
        profile: { handle: "you", displayName: "You" },
        stats: { pintsLogged: 3, cheapestPintGbp: 4.8, crawlsPosted: 0, memoriesPosted: 0 },
        viewerState: "loading",
      }),
    );

    const region = host.querySelector("[data-sample-skeleton]");
    expect(region?.className).toBe("sampleSkeleton profileHeaderLoading");
    const sample = sampleOf(region);
    const card = sample?.querySelector(":scope > header.profileHeader");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".profileCover")?.hasAttribute("data-sample-block")).toBe(true);
    expect(card?.querySelector("img.profileAvatar")).not.toBeNull();
    expect(card?.querySelectorAll(".profileStat")).toHaveLength(6);
    // The server HTML carries the sample, and a crawler followed its tiles to
    // /u/handle/people/followers. A sample tile links nowhere.
    expect(sample?.querySelectorAll("a")).toHaveLength(0);

    // Nothing of the viewer leaks into the wait.
    const text = host.textContent ?? "";
    expect(text).not.toContain("@you");
    expect(text).not.toContain("£");
    await afterGrace();
    expect(host.querySelector('p.sr-only[role="status"]')?.textContent).toBe("Loading profile");
  });
});

describe("the Activity grid", () => {
  it("waits behind the ready grid itself, drawn from six sample rows", async () => {
    await mount(createElement(ActivityClient));

    const region = host.querySelector("[data-sample-skeleton]");
    // The grid is a child of the region, never the region: below 1024px
    // .activityGrid is `display: contents`, which would drop the grace.
    expect(region?.className).toBe("sampleSkeleton");
    const sample = sampleOf(region);
    expect(sample?.querySelector(":scope > div.activityGrid > aside.activityRail .activityFilters")).not.toBeNull();
    expect(sample?.querySelectorAll(":scope > div.activityGrid > ul.activityList > li.activityItem")).toHaveLength(6);
    expectNoSamplePrefetch(sample);
    await afterGrace();
    expect(host.querySelector('p.sr-only[role="status"]')?.textContent).toBe("Loading your activity");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swaps the sample for the same grid once the rows arrive", async () => {
    session.unresolved = false;
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? new Response(null, { status: 204 })
        : new Response(
            JSON.stringify({
              notifications: [
                {
                  id: "n1",
                  actorHandle: "amy",
                  kind: "follow",
                  createdAt: "2026-10-01T12:00:00.000Z",
                  read: false,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
    );
    await mount(createElement(ActivityClient));
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(host.querySelector("[data-sample-skeleton]")).toBeNull();
    const grid = host.querySelector("div.activityGrid");
    expect(grid?.querySelector(":scope > aside.activityRail .activityFilters")).not.toBeNull();
    expect(grid?.querySelectorAll(":scope > ul.activityList > li.activityItem")).toHaveLength(1);
    expect(grid?.textContent).toContain("@amy");
  });
});
