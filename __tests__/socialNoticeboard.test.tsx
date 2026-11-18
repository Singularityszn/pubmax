// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ request: vi.fn() }));
const actor = vi.hoisted(() => ({ id: "alice", revision: 1 }));
const composer = vi.hoisted(() => ({ save: null as null | ((post: SocialPostDTO) => void), outbox: null as null | ((post: SocialPostDTO) => void), edit: null as null | Partial<SocialPostDTO> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: actor.id }, accountRevision: actor.revision, identityResolved: true }) }));
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
import { mergeSocialPostHead, readSocialPostHead, readSocialPostWindow, type SocialPostWindow } from "@/lib/socialPostWindow";
import type { SocialPostDTO } from "@/lib/socialPosts";
import type { SocialPostsShellState } from "@/lib/socialShell";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const feedPost = (body: string, hour: number): SocialPostDTO => ({
  id: body, body, createdAt: `2026-11-16T${String(hour).padStart(2, "0")}:00:00Z`, author: { handle: "bob" },
  ownedByViewer: false, venueName: null, hashtags: [], kind: "standard", visibility: "friends",
  area: null, venueId: null, venueProjected: false, commentPolicy: "open", photo: null,
  nameHidden: false, moderationState: "approved", featureRequest: null, revision: 0,
  mutationVersion: 0, editedAt: null, updatedAt: `2026-11-16T${String(hour).padStart(2, "0")}:00:00Z`,
});
function feedResponse<T extends { posts: Pick<SocialPostDTO, "id" | "createdAt">[]; nextCursor: string | null }>(page: T): Response {
  const last = page.posts.at(-1);
  return Response.json({ scannedThrough: last ? { id: last.id, createdAt: last.createdAt } : null, ...page });
}
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
  actor.id = "alice";
  actor.revision = 1;
});

it("announces a cold feed failure once and recovers through Retry", async () => {
  let failed = true;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    return failed ? Response.json({}, { status: 503 }) : feedResponse({ posts: [feedPost("Recovered post", 12)], nextCursor: null });
  });
  await mountFeed();
  const announcements = [...host.querySelectorAll('.socialFeed [role="status"], .socialFeed [role="alert"]')]
    .filter(node => node.textContent?.trim());
  expect(announcements).toHaveLength(1);
  expect(announcements[0]?.getAttribute("role")).toBe("alert");
  failed = false;
  await act(async () => host.querySelector<HTMLButtonElement>(".socialFeedError button")!.click());
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(1);
  expect(host.querySelector(".socialFeedError")).toBeNull();
});

it("bounds a deep refresh and keeps the fresh continuation reachable", async () => {
  const window = await readSocialPostWindow(async cursor => {
    const index = cursor ? Number(cursor) : 0;
    const post = feedPost(`Post ${index}`, 12);
    return { posts: [post], nextCursor: String(index + 1), scannedThrough: post };
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
    return feedResponse({ posts: [feedPost(`Page ${index + 1}`, 12)], nextCursor: String(index + 1) });
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
    return feedResponse({ posts: [feedPost(`Page ${index + 1}`, 16 - index)], nextCursor: String(index + 1) });
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
      return feedResponse({ posts: [feedPost(`${version} page ${index + 1}`, 16 - index)], nextCursor: String(index + 1) });
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
    return feedResponse({ posts: [{ ...feedPost(`Page ${index + 1}`, 16 - index), ownedByViewer: index === 3 }], nextCursor: String(index + 1) });
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
    await act(async () => finish(feedResponse({ posts: [feedPost("Stale response", 16)], nextCursor: null })));
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
      return feedResponse({ posts: [{ ...feedPost(`Page ${index + 1}`, 16 - index), visibility: "public", area: "camden", hashtags: ["garden"], ownedByViewer: index === 3 }], nextCursor: String(index + 1) });
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
      return feedResponse({ posts: [index === 3 ? post : { ...feedPost(`Page ${index + 1}`, 16 - index), visibility: "public", area: "camden", hashtags: ["garden"] }], nextCursor: String(index + 1) });
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
    return feedResponse({ posts: row.visibility === "private" ? [] : [row], nextCursor: String(index + 1) });
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

it.each([
  { label: "unrelated private origin post", target: "Origin post", visibility: "private" as const, count: 80 },
  { label: "unrelated public origin post", target: "Origin post", visibility: "public" as const, count: 80 },
  { label: "current friends post", target: "Following 60", visibility: "friends" as const, count: 80 },
  { label: "current private post", target: "Following 60", visibility: "private" as const, count: 79 },
])("applies a departed save to the current deep selection: $label", async ({ target, visibility, count }) => {
  // The selected contract retains known rows, cursor 80 and their original age.
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
  const otherKey = "social-posts:other:1:/api/social/posts?lane=following&limit=20";
  const otherPage = { posts: [feedPost("Other actor", 12)], pages: 4, nextCursor: "80" };
  writeSurfaceSnapshot(otherKey, otherPage, 1_000, { persist: false });
  const reads: string[] = [];
  let hold = false;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    reads.push(href);
    if (hold) return new Promise<Response>(() => {});
    const params = new URL(href, "http://localhost").searchParams;
    const start = Number(params.get("cursor") ?? 0);
    const rows = params.get("lane") === "following"
      ? Array.from({ length: 20 }, (_, offset) => feedPost(`Following ${start + offset}`, 12))
      : [{ ...feedPost("Origin post", 12), visibility: "public", ownedByViewer: true }];
    return feedResponse({ posts: rows, nextCursor: String(start + 20) });
  });
  const current: SocialPostsShellState = { valid: true, tab: "posts", feed: "following", area: null };
  const origin: SocialPostsShellState = { valid: true, tab: "posts", feed: "discover", area: null };
  const render = async (state: SocialPostsShellState) => act(async () => root.render(createElement(SocialPageClient, { initialState: state, rivalry: [], heritageCrawls: [] })));
  const more = async () => act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
  try {
    await mountFeed(current);
    for (let page = 0; page < 3; page += 1) await more();
    await render(origin);
    const pendingSave = composer.outbox!;
    await render(current);
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(80);
    clock.mockReturnValue(299_000);
    const readsBeforeSave = reads.length;
    await act(async () => pendingSave({ ...feedPost(target, 12), visibility, body: "Accepted departed edit", ownedByViewer: true }));
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(count);
    expect(host.textContent).toContain("Following 0");
    expect(host.textContent).toContain("Following 79");
    expect(host.textContent?.includes("Accepted departed edit")).toBe(target === "Following 60" && visibility === "friends");
    expect(reads).toHaveLength(readsBeforeSave);
    expect(readSurfaceSnapshot(otherKey)).toEqual(otherPage);
    await more();
    expect(new URL(reads.at(-1)!, "http://localhost").searchParams.get("cursor")).toBe("80");
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(count + 20);
    // Returning to the inactive origin must read it again.
    await render(origin);
    expect(reads).toHaveLength(readsBeforeSave + 2);
    await render(current);
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(count + 20);
    await act(async () => root.unmount());
    root = createRoot(host);
    clock.mockReturnValue(301_001);
    hold = true;
    await render(current);
    expect(host.querySelectorAll(".socialPostList:not(.sampleSkeleton) .socialPostCard")).toHaveLength(0);
  } finally {
    clock.mockRestore();
  }
});

it("ignores an edit acknowledgement from a previous committed actor", async () => {
  let hold = false;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: actor.id });
    if (hold) return new Promise<Response>(() => {});
    return feedResponse({ posts: [feedPost(`${actor.id} row`, 12)], nextCursor: null, items: [] });
  });
  await mountFeed();
  const pendingSave = composer.outbox!;
  actor.id = "other";
  actor.revision = 2;
  await act(async () => root.render(createElement(SocialPageClient, { initialState: { valid: true, tab: "posts", feed: "following", area: null }, rivalry: [], heritageCrawls: [] })));
  const key = "social-posts:other:2:/api/social/posts?lane=following&limit=20";
  const before = readSurfaceSnapshot(key);
  expect(before).not.toBeNull();
  const departedKey = "social-posts:alice:1:/api/social/posts?lane=discover&limit=20";
  writeSurfaceSnapshot(departedKey, { posts: [feedPost("Alice detached row", 12)] }, Date.now(), { persist: false });
  const departedBefore = readSurfaceSnapshot(departedKey);
  hold = true;
  const requestsBeforeSave = transport.request.mock.calls.length;
  await act(async () => pendingSave({ ...feedPost("other row", 12), body: "Previous actor acknowledgement" }));
  expect(transport.request.mock.calls.length).toBe(requestsBeforeSave);
  expect(host.textContent).toContain("other row");
  expect(host.textContent).not.toContain("Previous actor acknowledgement");
  expect(readSurfaceSnapshot(key)).toEqual(before);
  expect(readSurfaceSnapshot(departedKey)).toEqual(departedBefore);
});

it.each(["pagination", "edit"])("does not renew the first page's age after %s", async action => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
  let hold = false;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (hold) return new Promise<Response>(() => {});
    const index = Number(new URL(href, "http://localhost").searchParams.get("cursor") ?? 0);
    return feedResponse({ posts: [feedPost(index ? `Older post ${index}` : "First post", 12 - index)], nextCursor: String(index + 1) });
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

it("lets pagination supersede a held background head without a stale rewind", async () => {
  let reads = 0;
  let finish!: (response: Response) => void;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (href.includes("cursor=")) return feedResponse({ posts: [feedPost("Older post", 11)], nextCursor: "page-three" });
    if (++reads > 1) return new Promise<Response>(resolve => { finish = resolve; });
    return feedResponse({ posts: [feedPost("Original post", 12)], nextCursor: "older" });
  });
  await mountFeed();
  await act(async () => window.dispatchEvent(new Event("focus")));
  const more = [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!;
  expect(more.disabled).toBe(false);
  await act(async () => more.click());
  expect(host.textContent).toContain("Older post");
  await act(async () => finish(feedResponse({ posts: [feedPost("Stale head", 13)], nextCursor: null })));
  expect(host.textContent).toContain("Older post");
  expect(host.textContent).not.toContain("Stale head");
});

it("polls only the head, retains older pages and reports background failures politely", async () => {
  vi.useFakeTimers();
  try {
    let fail = false;
    let heads = 0;
    let tails = 0;
    transport.request.mockImplementation(async (href: string) => {
      if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
      if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
      if (href.includes("cursor=")) {
        tails++;
        return feedResponse({ posts: [feedPost(`Older ${tails}`, 12 - tails)], nextCursor: `older-${tails}` });
      }
      heads++;
      return fail ? Response.json({}, { status: 503 }) : feedResponse({ posts: [feedPost("Head", 12)], nextCursor: "older" });
    });
    await mountFeed();
    for (let n = 0; n < 2; n++) await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
    for (let n = 0; n < 4; n++) await act(async () => vi.advanceTimersByTime(15_000));
    expect(heads).toBe(5);
    expect(tails).toBe(2);
    expect(host.textContent).toContain("Older 2");
    const beforeHidden = heads;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(heads).toBe(beforeHidden);
    visibility.mockRestore();
    fail = true;
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(host.querySelector(".socialFeedInlineError")?.getAttribute("role")).toBe("status");
    const announcements = () => [...host.querySelectorAll('.socialFeed [role="status"], .socialFeed [role="alert"]')]
      .filter(node => node.textContent?.trim());
    expect(announcements()).toHaveLength(1);
    const beforeBackoff = heads;
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(heads).toBe(beforeBackoff);
    const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "Retry")!;
    await act(async () => retry.click());
    expect(announcements()).toHaveLength(1);
    expect(announcements()[0]?.getAttribute("role")).toBe("status");
    fail = false;
    await act(async () => retry.click());
    expect(host.querySelector(".socialFeedInlineError")).toBeNull();
  } finally { vi.useRealTimers(); }
});

it("keeps an accepted edit when its revalidation fails", async () => {
  let reads = 0;
  let finish!: (response: Response) => void;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (++reads > 1) return new Promise<Response>(resolve => { finish = resolve; });
    return feedResponse({ posts: [{ ...feedPost("Original post", 12), ownedByViewer: true }], nextCursor: null });
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
    return feedResponse({ posts: [feedPost("A warm post", 12)], nextCursor: null });
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

it("explicitly revalidates loaded pages through fresh cursors and removes a deleted older post", async () => {
  let changed = false;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    const cursor = new URL(href, "http://localhost").searchParams.get("cursor");
    if (!changed) return feedResponse(cursor
      ? { posts: [feedPost("Deleted older post", 10)], nextCursor: null }
      : { posts: [feedPost("Original first post", 11)], nextCursor: "old-cursor" });
    if (cursor === "old-cursor") throw new Error("A stale cursor skipped the new posts");
    return feedResponse(cursor
      ? { posts: [feedPost("Original first post", 11)], nextCursor: "fresh-continuation" }
      : { posts: [feedPost("New first post", 12)], nextCursor: "fresh-second-page" });
  });
  await mountFeed();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(2);
  changed = true;

  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Refresh posts")!.click());

  expect([...host.querySelectorAll(".socialPostCard")].map(card => card.textContent)).toEqual(["New first post", "Original first post"]);
  expect(host.textContent).not.toContain("Deleted older post");
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "Load more")).toBe(true);
});

it.each([401, 403, 503])("releases an error body once and preserves only authorised posts after %s", async status => {
  const cancel = vi.fn();
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (href.includes("cursor=")) return new Response(new ReadableStream({ cancel }), { status });
    return feedResponse({ posts: [feedPost("Protected post", 12)], nextCursor: "older" });
  });
  await mountFeed();
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(1);

  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());

  expect(cancel).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(status === 503 ? 1 : 0);
  expect(host.textContent?.includes("Protected post")).toBe(status === 503);
  expect(host.textContent).not.toContain("No posts here yet");
});

it("refuses a malformed successful feed response", async () => {
  transport.request.mockImplementation(async (href: string) => href === "/api/social/access"
    ? Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" })
    : Response.json({ posts: "untrusted", nextCursor: null, items: [] }));
  await mountFeed();
  expect(host.querySelector(".socialFeedError")).not.toBeNull();
  expect(host.querySelectorAll(".socialPostList:not(.sampleSkeleton) .socialPostCard")).toHaveLength(0);
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
    if (href.startsWith("/api/social/posts")) return feedResponse({
      posts: [...(newest ? [post("New post", "2026-11-16T11:00:00Z")] : []), post("First post", "2026-11-16T10:00:00Z")], nextCursor: "older",
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

it("keeps unchanged record identities and the browsing cursor on head reconciliation", () => {
  const first = feedPost("Head", 12), older = feedPost("Older", 11);
  const window = { posts: [first, older], nextCursor: "third-page", pages: 2 };
  expect(mergeSocialPostHead(window, { posts: [{ ...first }], nextCursor: "ignored", scannedThrough: first })).toBe(window);
  const edited = { ...first, body: "Changed", revision: 1 };
  const merged = mergeSocialPostHead(window, { posts: [edited, feedPost("New", 13)], nextCursor: "ignored", scannedThrough: first });
  expect(merged.posts.map(post => post.body)).toEqual(["New", "Changed", "Older"]);
  expect(merged.posts[2]).toBe(older);
  expect(merged.nextCursor).toBe("third-page");
  expect(merged.pages).toBe(2);
});

it("accounts for automatically accumulated rows when protecting a deep window", () => {
  const batch = (n: number) => Array.from({ length: 20 }, (_, i) => feedPost(`Batch ${n} row ${i}`, 12 + n));
  let window: SocialPostWindow = { posts: batch(0), pages: 1, nextCursor: "original-continuation" };
  for (let n = 1; n <= 3; n++) window = mergeSocialPostHead(window, { posts: batch(n), nextCursor: `head-${n}`, scannedThrough: batch(n).at(-1)! });
  expect(window.posts).toHaveLength(80);
  expect(window.pages).toBe(4);
  expect(window.nextCursor).toBe("original-continuation");
});

it.each([null, "old-continuation"])("removes withdrawn posts and exhausted continuation %s", nextCursor => {
  const current = { posts: [feedPost("Withdrawn", 12), feedPost("Deleted", 11)], pages: 2, nextCursor };
  const empty = mergeSocialPostHead(current, { posts: [], nextCursor: null, scannedThrough: null });
  expect(empty.posts).toEqual([]);
  expect(empty.nextCursor).toBeNull();
  const remaining = feedPost("Remaining", 11);
  const exhausted = mergeSocialPostHead(current, { posts: [remaining], nextCursor: null, scannedThrough: remaining });
  expect(exhausted.posts).toEqual([remaining]);
  expect(exhausted.nextCursor).toBeNull();
});

it.each([null, "older-continuation"])("reconciles timestamp ties while preserving untouched older rows and cursor %s", nextCursor => {
  const first = feedPost("z", 12), withdrawn = feedPost("y", 12), boundary = feedPost("m", 12);
  const olderTie = feedPost("a", 12), older = feedPost("Older", 11);
  const current = { posts: [first, withdrawn, boundary, olderTie, older], pages: 3, nextCursor };
  const merged = mergeSocialPostHead(current, { posts: [{ ...first }, { ...boundary }], nextCursor: "head-continuation", scannedThrough: boundary });
  expect(merged.posts).toEqual([first, boundary, olderTie, older]);
  expect(merged.posts[0]).toBe(first);
  expect(merged.posts[2]).toBe(olderTie);
  expect(merged.nextCursor).toBe(nextCursor);
  expect(merged.pages).toBe(3);
});

it("uses the head continuation when the refreshed range covers the held window", () => {
  const first = feedPost("First", 12), withdrawn = feedPost("Withdrawn", 13);
  const merged = mergeSocialPostHead({ posts: [withdrawn, first], pages: 1, nextCursor: null }, {
    posts: [first], nextCursor: "fresh-continuation", scannedThrough: first,
  });
  expect(merged.posts).toEqual([first]);
  expect(merged.nextCursor).toBe("fresh-continuation");
});

it.each([false, true])("removes a filtered scanned tail, including an empty page %s", empty => {
  const first = feedPost("Head", 13), tail = feedPost("Withdrawn tail", 12), older = feedPost("Untouched", 11);
  const current = { posts: [first, tail, older], pages: 2, nextCursor: "held-continuation" };
  const merged = mergeSocialPostHead(current, {
    posts: empty ? [] : [first], nextCursor: "scan-continuation", scannedThrough: tail,
  });
  expect(merged.posts).toEqual(empty ? [older] : [first, older]);
  expect(merged.posts.at(-1)).toBe(older);
  expect(merged.nextCursor).toBe("held-continuation");
  expect(merged.pages).toBe(2);
});

it.each(["2026-11-16T12:00:00.123900Z", "2026-11-16T12:00:00.1239+00:00"])("preserves older microsecond rows below %s", createdAt => {
  const boundary = { ...feedPost("Boundary", 12), id: "11111111-1111-4111-8111-111111111111", createdAt };
  const older = { ...feedPost("Untouched", 12), id: "ffffffff-ffff-4fff-8fff-ffffffffffff", createdAt: "2026-11-16T12:00:00.123100Z" };
  const current = { posts: [boundary, older], pages: 2, nextCursor: "held-continuation" };
  const merged = mergeSocialPostHead(current, { posts: [{ ...boundary }], nextCursor: "scan", scannedThrough: boundary });
  expect(merged).toBe(current);
});

it("recognises a scanned overlap without returning a visible held row", async () => {
  const first = feedPost("Withdrawn head", 13), tail = feedPost("Withdrawn tail", 12), older = feedPost("Untouched", 11);
  const current = { posts: [first, tail, older], pages: 2, nextCursor: "held-continuation" };
  const cursors: Array<string | null> = [];
  const result = await readSocialPostHead(async cursor => {
    cursors.push(cursor);
    return { posts: [], nextCursor: "scan-continuation", scannedThrough: tail };
  }, current);
  expect(cursors).toEqual([null]);
  expect(result.contiguous).toBe(true);
  expect(result.head.scannedThrough).toBe(tail);
  expect(mergeSocialPostHead(current, result.head).posts).toEqual([older]);
});

it("carries the final scanned range across a disjoint head and an empty filtered page", async () => {
  const incoming = feedPost("Incoming", 13), withdrawn = feedPost("Withdrawn", 12), older = feedPost("Untouched", 11);
  const current = { posts: [withdrawn, older], pages: 2, nextCursor: "held-continuation" };
  const cursors: Array<string | null> = [];
  const result = await readSocialPostHead(async cursor => {
    cursors.push(cursor);
    return cursor === null
      ? { posts: [incoming], nextCursor: "second", scannedThrough: incoming }
      : { posts: [], nextCursor: "third", scannedThrough: withdrawn };
  }, current);
  expect(cursors).toEqual([null, "second"]);
  expect(result.contiguous).toBe(true);
  expect(result.head.scannedThrough).toBe(withdrawn);
  const merged = mergeSocialPostHead(current, result.head);
  expect(merged.posts).toEqual([incoming, older]);
  expect(merged.nextCursor).toBe("held-continuation");
});

it.each(["following", "nearby", "discover"] as const)("reconciles an empty scanned %s page without losing older rows", async feed => {
  const head = feedPost("Withdrawn head", 13);
  const tail = { ...feedPost("Withdrawn tail", 12), id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-11-16T12:00:00.123900Z" };
  const older = { ...feedPost("Untouched older row", 12), id: "ffffffff-ffff-4fff-8fff-ffffffffffff", createdAt: "2026-11-16T12:00:00.123100Z" };
  let withdrawn = false;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (href.includes("cursor=")) return feedResponse({ posts: [older], nextCursor: null });
    return feedResponse({ posts: withdrawn ? [] : [head, tail], nextCursor: "older", scannedThrough: tail });
  });
  await mountFeed({ valid: true, tab: "posts", feed, area: feed === "nearby" ? "camden" : null });
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!.click());
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(3);
  withdrawn = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect([...host.querySelectorAll(".socialPostCard")].map(card => card.textContent)).toEqual(["Untouched older row"]);
  expect(host.querySelector(".socialFeedInlineError")).toBeNull();
  expect([...host.querySelectorAll("button")].find(button => button.textContent === "Load more")).toBeUndefined();
});

it("accepts authoritative same-version venue redaction and nested profile changes", () => {
  const previous = { ...feedPost("Known post", 12), venueProjected: true, venueId: "known-pub", venueName: "Known pub" };
  const fresh = { ...previous, venueProjected: false, venueId: null, venueName: null, author: { handle: "new-handle" } };
  const merged = mergeSocialPostHead({ posts: [previous], pages: 1, nextCursor: null }, { posts: [fresh], nextCursor: null, scannedThrough: fresh });
  expect(merged.posts[0]).toBe(fresh);
  expect(merged.posts[0]?.venueId).toBeNull();
  expect(merged.posts[0]?.author.handle).toBe("new-handle");
});

it("retains equal DTO identities regardless of JSON object field order", () => {
  const previous = { ...feedPost("Known post", 12), hashtags: ["garden"] };
  const fresh = Object.fromEntries(Object.entries(previous).reverse()) as SocialPostDTO;
  fresh.author = { ...previous.author };
  fresh.hashtags = [...previous.hashtags];
  const window = { posts: [previous], pages: 1, nextCursor: null };
  expect(mergeSocialPostHead(window, { posts: [fresh], nextCursor: null, scannedThrough: fresh })).toBe(window);
});

it("keeps a known empty feed failure polite and offers recovery", async () => {
  let failed = false;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    return failed ? Response.json({}, { status: 503 }) : feedResponse({ posts: [], nextCursor: null });
  });
  await mountFeed();
  expect(host.querySelector(".socialFeed")).toBeNull();
  failed = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('.socialFeedInlineError[role="status"]')).not.toBeNull();
  const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "Retry")!;
  expect(retry).toBeDefined();
  failed = false;
  await act(async () => retry.click());
  expect(host.querySelector(".socialFeedInlineError")).toBeNull();
});

it.each(["cold", "populated", "empty"])("keeps %s Retry focused and coalesces pending recovery", async surface => {
  let phase: "initial" | "failure" | "held" | "recovered" = surface === "cold" ? "failure" : "initial";
  const pending: { resolve: (response: Response) => void; signal: AbortSignal }[] = [];
  transport.request.mockImplementation(async (href: string, init: RequestInit) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    if (phase === "held") return new Promise<Response>(resolve => pending.push({ resolve, signal: init.signal as AbortSignal }));
    if (phase === "failure") return Response.json({}, { status: 503 });
    return feedResponse({ posts: surface === "empty" && phase === "initial" ? [] : [feedPost("Recovered post", 12)], nextCursor: null });
  });
  await mountFeed();
  if (surface !== "cold") {
    phase = "failure";
    await act(async () => window.dispatchEvent(new Event("focus")));
  }
  const retry = host.querySelector<HTMLButtonElement>(surface === "cold" ? ".socialFeedError button" : ".socialFeedInlineError button")!;
  const notice = retry.parentElement;
  retry.focus();
  phase = "held";
  await act(async () => { retry.click(); retry.click(); });
  expect(pending).toHaveLength(1);
  expect(retry.isConnected).toBe(true);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  await act(async () => retry.click());
  expect(pending).toHaveLength(1);
  expect(pending[0]!.signal.aborted).toBe(false);
  await act(async () => pending[0]!.resolve(Response.json({}, { status: 503 })));
  expect(retry.isConnected).toBe(true);
  expect(retry.parentElement).toBe(notice);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-disabled")).toBe("false");
  if (surface === "empty") expect(host.querySelector('.socialFeedInlineError[role="status"]')).not.toBeNull();
  phase = "recovered";
  await act(async () => retry.click());
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(1);
  expect(host.querySelector(".socialFeedInlineError, .socialFeedError")).toBeNull();
});

it.each([30, 200])("keeps a feed contiguous after %s posts arrive between heads", async arrival => {
  let incoming = false;
  const rows = Array.from({ length: arrival + 60 }, (_, i) => ({
    ...feedPost(`Report ${i}`, 12), createdAt: new Date(Date.UTC(2026, 10, 17, 12) - i * 60_000).toISOString(),
  }));
  const reads: number[] = [];
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    const cursor = new URL(href, "http://localhost").searchParams.get("cursor");
    const offset = cursor ? Number(cursor) : incoming ? 0 : arrival;
    reads.push(offset);
    return feedResponse({ posts: rows.slice(offset, offset + 20), nextCursor: String(offset + 20) });
  });
  await mountFeed();
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(20);
  incoming = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  if (arrival === 30) {
    const more = [...host.querySelectorAll("button")].find(button => button.textContent === "Load more")!;
    await act(async () => more.click());
    expect([...host.querySelectorAll(".socialPostCard")].some(card => card.textContent === "Report 20")).toBe(true);
    expect(reads).toEqual([30, 0, 20, 50]);
  } else {
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(20);
    expect(host.querySelector('[role="status"].socialFeedNewPosts')).not.toBeNull();
    expect(reads).toEqual([200, 0, 20, 40]);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(reads).toEqual([200, 0, 20, 40]);
    const refresh = [...host.querySelectorAll("button")].find(button => button.textContent === "Refresh posts")!;
    await act(async () => refresh.click());
    expect(host.querySelector('[role="status"].socialFeedNewPosts')).toBeNull();
    expect(host.querySelectorAll(".socialPostCard")).toHaveLength(20);
    expect(host.textContent).toContain("Report 0");
  }
});

it("keeps pagination reachable when a background head populates an empty feed", async () => {
  let published = false;
  transport.request.mockImplementation(async (href: string) => {
    if (href === "/api/social/access") return Response.json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: "alice" });
    if (!href.startsWith("/api/social/posts")) return Response.json({ items: [] });
    const offset = Number(new URL(href, "http://localhost").searchParams.get("cursor") ?? 0);
    return feedResponse({ posts: published ? Array.from({ length: 20 }, (_, i) => feedPost(`New report ${offset + i}`, 12)) : [], nextCursor: published ? String(offset + 20) : null });
  });
  await mountFeed();
  expect(host.querySelector(".socialFeed")).toBeNull();
  published = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(20);
  const more = [...host.querySelectorAll("button")].find(button => button.textContent === "Load more");
  expect(more).toBeDefined();
  await act(async () => more!.click());
  expect(host.querySelectorAll(".socialPostCard")).toHaveLength(40);
  expect(host.textContent).toContain("New report 39");
});
