// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ request: vi.fn() }));
const composer = vi.hoisted(() => ({ save: null as null | ((post: SocialPostDTO) => void), outbox: null as null | ((post: SocialPostDTO) => void), edit: null as null | Partial<SocialPostDTO> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "alice" }, accountRevision: 1, identityResolved: true }) }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ unresolved: false, signedIn: true, signedOut: false }) }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: transport.request }));
vi.mock("@/lib/deviceAccountIdentity", () => ({ subscribeDeviceIdentity: () => () => undefined }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => createElement("h2", null, "Your crews") }));
vi.mock("@/components/social/StarterPacks", () => ({ default: () => null }));
vi.mock("@/components/social/FindYourLot", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/components/social/PubRankingPanel", () => ({ default: () => null }));
vi.mock("@/components/social/SocialPostCard", () => ({ default: ({ post, editor }: { post: { body: string }; editor?: React.ReactNode }) => createElement("article", { className: "socialPostCard" }, post.body, editor) }));
vi.mock("@/app/social/SocialPostEditor", () => ({ SocialPostEditor: ({ post, onSaved }: { post: { body: string }; onSaved: (post: unknown) => void }) =>
  createElement("button", { onClick: () => onSaved({ ...post, body: "Accepted edit", ...composer.edit }) }, "Save edit") }));
vi.mock("@/app/social/SocialComposer", () => ({ default: ({ onSaved }: { onSaved: (post: SocialPostDTO) => void }) => { composer.save = onSaved; return null; } }));
vi.mock("@/app/social/SocialTagInbox", () => ({ default: () => null }));
vi.mock("@/app/social/SocialOutbox", () => ({ default: ({ onPostChanged }: { onPostChanged: (post: SocialPostDTO) => void }) => { composer.outbox = onPostChanged; return null; } }));

import SocialPageClient from "@/app/social/SocialPageClient";
import { clearSurfaceCache, readSurfaceSnapshot, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";
import { readSocialPostWindow } from "@/lib/socialPostWindow";
import type { SocialPostDTO } from "@/lib/socialPosts";
import type { SocialPostsShellState } from "@/lib/socialShell";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const feedPost = (body: string, hour: number): SocialPostDTO => ({
  id: body, body, createdAt: `2026-11-16T${hour}:00:00Z`, author: { handle: "bob" },
  ownedByViewer: false, venueName: null, hashtags: [], kind: "standard", visibility: "friends",
  area: null, venueId: null, venueProjected: false, commentPolicy: "open", photo: null,
  nameHidden: false, moderationState: "approved", featureRequest: null, revision: 0,
  mutationVersion: 0, editedAt: null, updatedAt: `2026-11-16T${hour}:00:00Z`,
});
async function mountFeed(initialState: SocialPostsShellState = { valid: true, tab: "posts", feed: "following", area: null }): Promise<void> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  root = createRoot(host);
  document.body.appendChild(host);
  await act(async () => root.render(createElement(SocialPageClient, {
    initialState, rivalry: [], heritageCrawls: [],
  })));
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  clearSurfaceCache();
  composer.edit = null;
});

it("bounds a deep refresh and keeps the fresh continuation reachable", async () => {
  const window = await readSocialPostWindow(async cursor => {
    const index = cursor ? Number(cursor) : 0;
    return { posts: [feedPost(`Post ${index}`, 12)], nextCursor: String(index + 1) };
  }, 20);
  expect(window.pages).toBe(3);
  expect(window.posts).toHaveLength(3);
  expect(window.nextCursor).toBe("3");
});

it("keeps a four-page window during automatic refresh and offers an explicit refresh", async () => {
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    const cursor = new URL(href, "http://localhost").searchParams.get("cursor");
    const index = Number(cursor ?? 0);
    return Response.json({ posts: [feedPost(`Page ${index + 1}`, 12)], nextCursor: String(index + 1) });
  });
  await mountFeed();
  for (let page = 0; page < 3; page += 1) {
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
  }
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(4);

  await act(async () => window.dispatchEvent(new Event("focus")));

  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(4);
  expect(host.textContent).toContain("Page 4");
  const refresh = [...host.querySelectorAll("button")].find(button => button.textContent === "Refresh posts")!;
  expect(refresh).toBeDefined();
  await act(async () => refresh.click());
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(3);
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "Load more")).toBe(true);
});

it.each(["view", "remount"])("retains a four-page window and its continuation after %s", async mode => {
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    const index = Number(new URL(href, "http://localhost").searchParams.get("cursor") ?? 0);
    return Response.json({ posts: [feedPost(`Page ${index + 1}`, 16 - index)], nextCursor: String(index + 1) });
  });
  await mountFeed();
  for (let page = 0; page < 3; page += 1) {
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
  }
  if (mode === "view") {
    await act(async () => root.render(createElement(SocialPageClient, {
      initialState: { valid: true, tab: "posts", feed: "nearby", area: null }, rivalry: [], heritageCrawls: [],
    })));
  } else {
    await act(async () => root.unmount());
    root = createRoot(host);
  }

  await act(async () => root.render(createElement(SocialPageClient, {
    initialState: { valid: true, tab: "posts", feed: "following", area: null }, rivalry: [], heritageCrawls: [],
  })));

  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(4);
  expect(host.textContent).toContain("Page 4");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(5);
  expect(host.textContent).toContain("Page 5");
});

it.each(["nearby", "discover"])("expires a detached deep window after visiting %s", async selection => {
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  try {
    let version = "Original";
    transport.request.mockImplementation(async (href: string) => {
      if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
      if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
      const index = Number(new URL(href, "http://localhost").searchParams.get("cursor") ?? 0);
      return Response.json({ posts: [feedPost(`${version} page ${index + 1}`, 16 - index)], nextCursor: String(index + 1) });
    });
    await mountFeed();
    for (let page = 0; page < 3; page += 1) {
      await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
    }
    // Mounted windows retain position, even after the detached-cache lifetime.
    now += 5 * 60_000 + 1;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(4);
    await act(async () => root.render(createElement(SocialPageClient, {
      initialState: selection === "nearby"
        ? { valid: true, tab: "posts", feed: "nearby", area: null }
        : { valid: true, tab: "discover", feed: null, area: null },
      rivalry: [], heritageCrawls: [],
    })));
    version = "Fresh";
    await act(async () => root.render(createElement(SocialPageClient, {
      initialState: { valid: true, tab: "posts", feed: "following", area: null }, rivalry: [], heritageCrawls: [],
    })));
    expect(host.textContent).toContain("Fresh page 1");
    expect(host.textContent).not.toContain("Original page");
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(1);
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
    expect(host.textContent).toContain("Fresh page 2");
  } finally {
    clock.mockRestore();
  }
});

it.each(["edit", "publish", "outbox edit", "edit during refresh"])("keeps all four pages after %s", async action => {
  let refreshing = false;
  let finish!: (response: Response) => void;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (refreshing) return new Promise<Response>(resolve => { finish = resolve; });
    const index = Number(new URL(href, "http://localhost").searchParams.get("cursor") ?? 0);
    return Response.json({ posts: [{ ...feedPost(`Page ${index + 1}`, 16 - index), ownedByViewer: index === 3 }], nextCursor: String(index + 1) });
  });
  await mountFeed();
  for (let page = 0; page < 3; page += 1) {
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
  }
  if (action === "edit during refresh") {
    refreshing = true;
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Refresh posts")!.click());
  }

  await act(async () => {
    if (action === "publish") composer.save!(feedPost("Published post", 20));
    else if (action === "outbox edit") composer.outbox!({ ...feedPost("Accepted edit", 13), id: "Page 4", ownedByViewer: true });
    else host.querySelector<HTMLButtonElement>(".socialPostCard button")!.click();
  });
  if (action === "edit during refresh") {
    await act(async () => finish(Response.json({ posts: [feedPost("Stale response", 16)], nextCursor: null })));
  }

  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(4);
  expect(host.textContent).toContain(action === "publish" ? "Page 4" : "Accepted edit");
  expect(host.textContent).not.toContain("Stale response");
  expect([...host.querySelectorAll("button")].find(button => button.textContent === "Refresh posts")!.disabled).toBe(false);
});

const editMembershipCases: { label: string; state: SocialPostsShellState; edit: Partial<SocialPostDTO>; retained: boolean }[] = [
  { label: "Nearby private edit", state: { valid: true, tab: "posts", feed: "nearby", area: "camden" }, edit: { visibility: "private" }, retained: false },
  { label: "Nearby area edit", state: { valid: true, tab: "posts", feed: "nearby", area: "camden" }, edit: { area: "balham" }, retained: false },
  { label: "Nearby matching edit", state: { valid: true, tab: "posts", feed: "nearby", area: "camden" }, edit: { body: "Still in this lane" }, retained: true },
  { label: "Across town friends edit", state: { valid: true, tab: "posts", feed: "discover", area: null }, edit: { visibility: "friends" }, retained: false },
  { label: "Across town removed hashtag", state: { valid: true, tab: "posts", feed: "discover", area: null, tag: "garden" }, edit: { hashtags: [] }, retained: false },
  { label: "Across town matching hashtag", state: { valid: true, tab: "posts", feed: "discover", area: null, tag: "garden" }, edit: { hashtags: ["garden", "pub"] }, retained: true },
  { label: "Following private edit", state: { valid: true, tab: "posts", feed: "following", area: null }, edit: { visibility: "private" }, retained: false },
];

for (const door of ["card", "Outbox"] as const) {
  it.each(editMembershipCases)(`preserves deep feed membership and continuation after a ${door} $label`, async ({ state, edit, retained }) => {
    transport.request.mockImplementation(async (href: string) => {
      if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
      if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
      const index = Number(new URL(href, "http://localhost").searchParams.get("cursor") ?? 0);
      return Response.json({ posts: [{ ...feedPost(`Page ${index + 1}`, 16 - index), visibility: "public", area: "camden", hashtags: ["garden"], ownedByViewer: index === 3 }], nextCursor: String(index + 1) });
    });
    await mountFeed(state);
    for (let page = 0; page < 3; page += 1) {
      await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
    }
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(4);
    composer.edit = { body: "Accepted edit", ...edit };
    await act(async () => {
      if (door === "card") host.querySelector<HTMLButtonElement>(".socialPostCard button")!.click();
      else composer.outbox!({ ...feedPost("Page 4", 13), ownedByViewer: true, visibility: "public", area: "camden", hashtags: ["garden"], ...composer.edit });
    });
    const count = retained ? 4 : 3;
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(count);
    for (const body of ["Page 1", "Page 2", "Page 3"]) expect(host.textContent).toContain(body);
    if (retained) expect(host.textContent).toContain(edit.body ?? "Accepted edit");
    else expect(host.textContent).not.toContain("Accepted edit");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(count + 1);
    expect(host.textContent).toContain("Page 5");
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(createElement(SocialPageClient, { initialState: state, rivalry: [], heritageCrawls: [] })));
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(count + 1);
    if (!retained) expect(host.textContent).not.toContain("Accepted edit");
  });
}

const inactiveEditCases: { label: string; state: SocialPostsShellState; edit: Partial<SocialPostDTO> }[] = [
  { label: "Across town private post", state: { valid: true, tab: "posts", feed: "discover", area: null }, edit: { visibility: "private" } },
  { label: "Nearby moved post", state: { valid: true, tab: "posts", feed: "nearby", area: "camden" }, edit: { area: "balham" } },
  { label: "Across town removed hashtag", state: { valid: true, tab: "posts", feed: "discover", area: null, tag: "garden" }, edit: { hashtags: [] } },
  { label: "Across town changed body", state: { valid: true, tab: "posts", feed: "discover", area: null }, edit: { body: "New body" } },
];

for (const door of ["unselected Outbox", "active Outbox", "active card"] as const) {
  it.each(inactiveEditCases)(`discards an inactive $label snapshot after an edit through ${door}`, async ({ state, edit }) => {
    const post = { ...feedPost("Page 4", 13), ownedByViewer: true, visibility: "public" as const, area: "camden" as const, hashtags: ["garden"] };
    const otherAccountKey = "social-posts:alice-other:1:/api/social/posts?lane=discover&limit=20";
    writeSurfaceSnapshot(otherAccountKey, { posts: [post], pages: 4, nextCursor: "4" }, Date.now(), { persist: false });
    transport.request.mockImplementation(async (href: string) => {
      if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
      if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
      const index = Number(new URL(href, "http://localhost").searchParams.get("cursor") ?? 0);
      return Response.json({ posts: [index === 3 ? post : { ...feedPost(`Page ${index + 1}`, 16 - index), visibility: "public", area: "camden", hashtags: ["garden"] }], nextCursor: String(index + 1) });
    });
    await mountFeed(state);
    const more = async () => act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
    for (let page = 0; page < 3; page += 1) await more();
    await act(async () => root.render(createElement(SocialPageClient, {
      initialState: { valid: true, tab: "posts", feed: door === "unselected Outbox" ? "nearby" : "following", area: null }, rivalry: [], heritageCrawls: [],
    })));
    if (door !== "unselected Outbox") {
      for (let page = 0; page < 3; page += 1) await more();
    }
    composer.edit = { body: "Accepted edit", ...edit };
    await act(async () => {
      if (door === "active card") host.querySelector<HTMLButtonElement>(".socialPostCard button")!.click();
      else composer.outbox!({ ...post, ...composer.edit });
    });
    if (door !== "unselected Outbox") {
      expect(host.querySelectorAll(".socialPostCard")).toHaveLength(edit.visibility === "private" ? 3 : 4);
      await more();
      expect(host.textContent).toContain("Page 5");
    }
    await act(async () => root.render(createElement(SocialPageClient, { initialState: state, rivalry: [], heritageCrawls: [] })));
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(1);
    expect(host.textContent).not.toContain("Page 4");
    await more();
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(2);
    expect(host.textContent).toContain("Page 2");
    expect(readSurfaceSnapshot(otherAccountKey)).toEqual({ posts: [post], pages: 4, nextCursor: "4" });
  });
}

it.each([
  { visibility: "private" as const },
  { body: "Accepted body after navigation" },
])("discards the departed deep window when a pending Outbox edit completes: %j", async edit => {
  let post = { ...feedPost("Page 4", 13), ownedByViewer: true, visibility: "public" as SocialPostDTO["visibility"] };
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    const index = Number(new URL(href, "http://localhost").searchParams.get("cursor") ?? 0);
    const row = index === 3 ? post : { ...feedPost(`Page ${index + 1}`, 16 - index), visibility: "public" };
    return Response.json({ posts: row.visibility === "private" ? [] : [row], nextCursor: String(index + 1) });
  });
  const state: SocialPostsShellState = { valid: true, tab: "posts", feed: "discover", area: null };
  await mountFeed(state);
  const more = async () => act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
  for (let page = 0; page < 3; page += 1) await more();
  const pendingSave = composer.outbox!;
  await act(async () => root.render(createElement(SocialPageClient, {
    initialState: { valid: true, tab: "posts", feed: "nearby", area: null }, rivalry: [], heritageCrawls: [],
  })));
  post = { ...post, ...edit };
  await act(async () => pendingSave(post));
  await act(async () => root.render(createElement(SocialPageClient, { initialState: state, rivalry: [], heritageCrawls: [] })));
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(1);
  for (let page = 0; page < 3; page += 1) await more();
  if (edit.visibility === "private") expect(host.textContent).not.toContain("Page 4");
  else expect(host.textContent).toContain("Accepted body after navigation");
});

it.each(["pagination", "edit"])("does not renew the first page's age after %s", async action => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
  let hold = false;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (hold) return new Promise<Response>(() => {});
    const index = Number(new URL(href, "http://localhost").searchParams.get("cursor") ?? 0);
    return Response.json({ posts: [feedPost(index ? `Older post ${index}` : "First post", 12 - index)], nextCursor: String(index + 1) });
  });
  try {
    await mountFeed();
    clock.mockReturnValue(299_000);
    for (let page = 0; page < 3; page += 1) {
      await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
    }
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(4);
    if (action === "edit") {
      hold = true;
      await act(async () => composer.outbox!({ ...feedPost("Older post 3", 9), body: "Edited older post" }));
      expect(host.textContent).toContain("Edited older post");
    }
    await act(async () => root.unmount());
    host.remove();
    clock.mockReturnValue(301_001);
    hold = true;

    await mountFeed();

    expect(host.textContent).not.toContain("First post");
    expect(host.textContent).not.toContain("Older post");
    expect(host.textContent).not.toContain("Edited older post");
  } finally { clock.mockRestore(); }
});

it("disables pagination while a refresh is pending and preserves the visible posts", async () => {
  let reads = 0;
  let finish!: (response: Response) => void;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (++reads > 1) return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json({ posts: [feedPost("Original post", 12)], nextCursor: "older" });
  });
  await mountFeed();
  await act(async () => window.dispatchEvent(new Event("focus")));
  const loadMore = [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!;
  expect(loadMore.disabled).toBe(true);
  expect(host.querySelector(".socialPostCard")?.textContent).toBe("Original post");

  await act(async () => finish(Response.json({ posts: [feedPost("Refreshed post", 12)], nextCursor: "fresh-older" })));

  expect(host.querySelector(".socialPostCard")?.textContent).toBe("Refreshed post");
  expect(loadMore.disabled).toBe(false);
});

it("keeps an accepted edit when its revalidation fails", async () => {
  let reads = 0;
  let finish!: (response: Response) => void;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (++reads > 1) return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json({ posts: [{ ...feedPost("Original post", 12), ownedByViewer: true }], nextCursor: null });
  });
  await mountFeed();

  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Save edit")!.click());
  expect(host.querySelector(".socialPostCard")?.textContent).toContain("Accepted edit");
  await act(async () => finish(Response.json({ error: "Unavailable" }, { status: 503 })));

  expect(host.querySelector(".socialPostCard")?.textContent).toContain("Accepted edit");
  expect(host.querySelector(".socialPostCard")?.textContent).not.toContain("Original post");
});

it("keeps the warm Following window while visiting a view with no feed request", async () => {
  let reads = 0;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (++reads > 1) return new Promise<Response>(() => {});
    return Response.json({ posts: [feedPost("A warm post", 12)], nextCursor: null });
  });
  await mountFeed();
  await act(async () => root.render(createElement(SocialPageClient, {
    initialState: { valid: true, tab: "posts", feed: "nearby", area: null }, rivalry: [], heritageCrawls: [],
  })));

  await act(async () => root.render(createElement(SocialPageClient, {
    initialState: { valid: true, tab: "posts", feed: "following", area: null }, rivalry: [], heritageCrawls: [],
  })));

  expect(host.querySelector(".socialPostCard")?.textContent).toBe("A warm post");
});

it("revalidates loaded pages through fresh cursors and removes a deleted older post", async () => {
  let changed = false;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    const cursor = new URL(href, "http://localhost").searchParams.get("cursor");
    if (!changed) return Response.json(cursor
      ? { posts: [feedPost("Deleted older post", 10)], nextCursor: null }
      : { posts: [feedPost("Original first post", 11)], nextCursor: "old-cursor" });
    if (cursor === "old-cursor") throw new Error("A stale cursor skipped the new posts");
    return Response.json(cursor
      ? { posts: [feedPost("Original first post", 11)], nextCursor: "fresh-continuation" }
      : { posts: [feedPost("New first post", 12)], nextCursor: "fresh-second-page" });
  });
  await mountFeed();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(2);
  changed = true;

  await act(async () => window.dispatchEvent(new Event("focus")));

  expect([...host.querySelectorAll(".socialPostCard")].map(card => card.textContent)).toEqual(["New first post", "Original first post"]);
  expect(host.textContent).not.toContain("Deleted older post");
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "Load more")).toBe(true);
});

it.each([401, 403])("removes protected posts when loading more is denied with %s", async status => {
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (href.includes("cursor=")) return Response.json({ error: "Denied" }, { status });
    return Response.json({ posts: [feedPost("Protected post", 12)], nextCursor: "older" });
  });
  await mountFeed();
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(1);

  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());

  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(0);
  expect(host.textContent).not.toContain("Protected post");
  expect(host.textContent).not.toContain("No posts here yet");
});

it("keeps posts after a failed next page and reads new posts on focus without a reload", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const post = (id: string, createdAt: string) => ({
    id, body: id, createdAt, author: { handle: "bob" }, ownedByViewer: false,
    venueName: null, hashtags: [],
  });
  let newest = false;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (href.includes("cursor=")) return Response.json({ error: "Unavailable" }, { status: 503 });
    if (href.startsWith("/api/social/posts")) return Response.json({
      posts: [post("First post", "2026-11-16T10:00:00Z"), ...(newest ? [post("New post", "2026-11-16T11:00:00Z")] : [])], nextCursor: "older",
    });
    return Response.json({ items: [] });
  });
  host = document.createElement("div");
  root = createRoot(host);
  document.body.appendChild(host);
  await act(async () => root.render(createElement(SocialPageClient, {
    initialState: { valid: true, tab: "posts", feed: "following", area: null }, rivalry: [], heritageCrawls: [],
  })));
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(1);
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("load more posts");
  expect(host.querySelector(".socialPostCard")?.textContent).toBe("First post");

  newest = true;
  await act(async () => window.dispatchEvent(new Event("focus")));

  expect([...host.querySelectorAll(".socialPostCard")].map(card => card.textContent)).toEqual(["New post", "First post"]);
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
