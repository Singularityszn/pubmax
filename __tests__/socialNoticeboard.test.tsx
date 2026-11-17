// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => ({ user: { id: "alice" }, accountRevision: 1, identityResolved: true }) }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ unresolved: false, signedIn: true, signedOut: false }) }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: transport.request }));
vi.mock("@/lib/deviceAccountIdentity", () => ({ subscribeDeviceIdentity: () => () => undefined }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => createElement("h2", null, "Your crews") }));
vi.mock("@/components/social/StarterPacks", () => ({ default: () => null }));
vi.mock("@/components/social/FindYourLot", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/components/social/PubRankingPanel", () => ({ default: () => null }));
vi.mock("@/app/social/SocialComposer", () => ({ default: () => null }));
vi.mock("@/app/social/SocialTagInbox", () => ({ default: () => null }));
vi.mock("@/app/social/SocialOutbox", () => ({ default: () => null }));

import SocialPageClient from "@/app/social/SocialPageClient";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it.each(["following", "discover"] as const)("hides an empty %s feed and keeps filters, crew tools and next steps", async (feedLane) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  transport.request.mockImplementation(async (href: string) => new Response(JSON.stringify(
    href === "/api/social/access"
      ? { state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" }
      : href.includes("interactions") ? { items: [] } : { posts: [], nextCursor: null },
  ), { headers: { "content-type": "application/json" } }));
  host = document.createElement("div");
  root = createRoot(host);
  document.body.appendChild(host);
  await act(async () => {
    root.render(createElement(SocialPageClient, {
      initialState: { valid: true, tab: "posts", feed: feedLane, area: null, tag: feedLane === "discover" ? "guinness" : null },
      rivalry: [], heritageCrawls: [],
    }));
  });
  const feed = host.querySelector('[aria-label="Social posts"]');
  const crews = [...host.querySelectorAll("h2")].find((heading) => heading.textContent === "Your crews");
  expect(feed).toBeNull();
  const clearTag = host.querySelector('a[aria-label="Clear the #guinness filter"]');
  if (feedLane === "discover") {
    expect(host.textContent).toContain("Tag: #guinness");
    expect(clearTag).not.toBeNull();
    expect(clearTag?.getAttribute("href")).toBe("/social?feed=discover");
  } else {
    expect(clearTag).toBeNull();
  }
  expect(crews).not.toBeUndefined();
  expect(host.querySelector('a[href="/messages"]')?.textContent).toContain("Messages");
  expect(host.querySelector('a[href="/pal"]')?.textContent).toContain("Pub Pal");
  expect(host.querySelector('a[href="/plan"]')?.textContent).toContain("Plan a crawl");
  expect(host.textContent).not.toContain("No posts here yet.");
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(0);
});
