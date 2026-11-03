// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const downloads = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/app/social/SocialLazy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/social/SocialLazy")>();
  const socialLazy: typeof actual.socialLazy = (load, label, loading) => actual.socialLazy(
    label === "Video" ? () => downloads.load(load) : load, label, loading,
  );
  return { socialLazy };
});
vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...props }: { href: string; children?: ReactNode; prefetch?: boolean }) => {
    delete props.prefetch;
    return createElement("a", { href, ...props }, children);
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ accountRevision: 0, identityResolved: true, user: { id: "reader" } }) }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ phase: "signed-in", signedIn: true, signedOut: false, unresolved: false }) }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => null }));
vi.mock("@/lib/deviceAccountIdentity", () => ({ subscribeDeviceIdentity: () => () => undefined }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/profile/HandleAvatar", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => null }));
vi.mock("@/components/social/PubRankingPanel", () => ({ default: () => null }));
vi.mock("@/components/social/CreatorListsLane", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/components/social/StarterPacks", () => ({ default: () => null }));
vi.mock("@/components/social/FindYourLot", () => ({ default: () => null }));
vi.mock("@/components/social/SocialPostActions", () => ({ default: () => null }));
vi.mock("@/components/founding/FoundersWallLink", () => ({ default: () => null }));
vi.mock("@/app/discover/DiscoverPageClient", () => ({ DiscoverBody: () => null }));
vi.mock("@/app/social/SocialOutbox", () => ({ default: () => null }));
vi.mock("@/app/social/SocialTagInbox", () => ({ default: () => null }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: async (url: string) => {
    if (url === "/api/social/access") return Response.json({ state: "verified" });
    if (url.startsWith("/api/social/interactions")) return Response.json({ items: [] });
    if (url.startsWith("/api/social/posts")) return Response.json({ posts: [{
      id: "reel-post", body: "A night at the Lamb", createdAt: "2026-11-01T19:00:00Z",
      author: { handle: "alice" }, ownedByViewer: false, venueName: null, hashtags: [],
      visibility: "public", kind: "standard", photo: null, venueProjected: false,
      video: { url: "/reel.mp4", durationSeconds: 10, reviewState: "approved" },
    }], nextCursor: null });
    throw new Error(`Unexpected request: ${url}`);
  },
}));

import SocialPageClient from "@/app/social/SocialPageClient";

it("restores each actual reel opener after a held rejection, retry, close and Escape", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let reject!: (error: Error) => void;
  let finish!: () => void;
  let loaded!: Promise<unknown>;
  downloads.load.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
    .mockImplementationOnce((load: () => Promise<unknown>) => {
      loaded = new Promise<void>((resolve) => { finish = resolve; }).then(load);
      return loaded;
    });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<SocialPageClient initialState={{ valid: true, tab: "posts", feed: "following", area: null }} rivalry={[]} heritageCrawls={[]} />);
    });
    const entry = host.querySelector<HTMLButtonElement>(".socialReelsEntry")!;
    expect(entry).not.toBeNull();
    expect(downloads.load).not.toHaveBeenCalled();
    entry.focus();
    await act(async () => { entry.click(); });
    expect(host.textContent).toContain("Loading video");
    expect(document.activeElement).toBe(entry);
    await act(async () => { reject(new Error("chunk unavailable")); });
    const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
    retry.focus();
    await act(async () => { retry.click(); });
    expect(document.activeElement).not.toBe(document.body);
    await act(async () => { finish(); await loaded; });
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close reels"]')!;
    expect(document.activeElement).toBe(close);
    await act(async () => { close.click(); });
    expect(document.querySelector('[role="dialog"][aria-label="Reels"]')).toBeNull();
    expect(document.activeElement).toBe(entry);
    expect(downloads.load).toHaveBeenCalledTimes(2);

    const video = host.querySelector<HTMLButtonElement>('[aria-label="Watch full screen"]')!;
    expect(video).not.toBeNull();
    await act(async () => { video.click(); });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close reels");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector('[role="dialog"][aria-label="Reels"]')).toBeNull();
    expect(document.activeElement).toBe(video);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    error.mockRestore();
    if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});
