// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialPostDTO } from "@/lib/socialPosts";
import { publishAuthActionState } from "@/lib/authedFetch";

const auth = vi.hoisted(() => ({
  user: { id: "account-a" } as { id: string } | null,
  handle: "alice" as string | null,
  identityResolved: true,
  accountRevision: 0,
  providerAuthState: "authenticated",
}));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => auth }));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "verified-session-token" }));

import SocialPostActions from "@/components/social/SocialPostActions";

const post: SocialPostDTO = {
  id: "11111111-1111-4111-8111-111111111111", kind: "standard", visibility: "public", body: "A good evening",
  area: null, venueId: null, hashtags: [], commentPolicy: "open", photo: null,
  moderationState: "approved", featureRequest: null, revision: 1, mutationVersion: 1,
  editedAt: null, createdAt: "2026-09-07T19:00:00Z", updatedAt: "2026-09-07T19:00:00Z",
  author: { handle: "bob" }, ownedByViewer: false, venueName: null, venueProjected: false,
};
const comment = (id: string, body = "See you there", moderationState = "approved") => ({
  id, postId: post.id, body, author: { handle: "bob" }, moderationState, createdAt: post.createdAt,
});
let currentPost: SocialPostDTO;
let cheered: boolean;
let requests: Array<{ path: string; init: RequestInit }>;
let respond: ((path: string, init: RequestInit) => Promise<Response> | Response | undefined) | null;
let container: HTMLDivElement;
let root: Root;
let visibleOnMount: boolean;
let intersections: Array<() => void>;

async function render(value = currentPost) {
  await act(async () => root.render(createElement(SocialPostActions, { post: value })));
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}. ${container.textContent}`);
  return found;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

async function type(value: string) {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function chooseReportReason(value: string) {
  await act(async () => {
    const input = container.querySelector("select")!;
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function openReport() {
  await act(async () => container.querySelector("summary")!.click());
}

function writes() { return requests.filter(({ init }) => init.method && init.method !== "GET"); }

beforeEach(() => {
  Object.assign(auth, { user: { id: "account-a" }, handle: "alice", identityResolved: true, accountRevision: 0, providerAuthState: "authenticated" });
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  currentPost = { ...post };
  cheered = false;
  requests = [];
  respond = null;
  visibleOnMount = true;
  intersections = [];
  vi.stubGlobal("IntersectionObserver", class {
    show: () => void;
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.show = () => callback([{ isIntersecting: true }]);
      intersections.push(this.show);
    }
    observe() { if (visibleOnMount) this.show(); }
    disconnect() {}
  });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const path = String(input);
    requests.push({ path, init });
    const override = respond?.(path, init);
    if (override) return override;
    if (path.startsWith("/api/social/posts/")) return Response.json({ post: currentPost });
    if (path.includes("view=summary")) return Response.json({ summary: { cheered, saved: false, reposted: false, cheerCount: cheered ? 8 : 7, repostCount: 0 } });
    if (path.includes("view=comments")) return Response.json({ items: [comment("c1")], nextCursor: null });
    if (init.method === "PUT" || init.method === "DELETE") {
      cheered = init.method === "PUT";
      return Response.json({ ok: true });
    }
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      return Response.json(body.action === "report"
        ? { report: { id: "report-1", createdAt: post.createdAt } }
        : { comment: comment("new-comment", "My comment", "pending") }, { status: 202 });
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Social post actions", () => {
  it("survives the StrictMode effect restart", async () => {
    await act(async () => root.render(createElement(StrictMode, null, createElement(SocialPostActions, { post: currentPost }))));
    expect(button("Cheer7").disabled).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it("makes no requests for offscreen posts and reads once when they enter the viewport", async () => {
    visibleOnMount = false;
    await render();
    expect(requests).toHaveLength(0);
    expect(button("Cheer").getAttribute("aria-pressed")).toBeNull();
    await act(async () => intersections[0]());
    expect(requests).toHaveLength(1);
    await act(async () => intersections[0]());
    expect(requests).toHaveLength(1);
    expect(writes()).toHaveLength(0);
  });

  it("reads only the visible cards when twenty posts mount together", async () => {
    visibleOnMount = false;
    const posts = Array.from({ length: 20 }, (_, index) => ({ ...currentPost,
      id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    }));
    await act(async () => root.render(createElement("div", null, posts.map(item => createElement(SocialPostActions, { key: item.id, post: item })))));
    expect(requests).toHaveLength(0);
    expect(intersections).toHaveLength(20);
    await act(async () => { intersections[0](); intersections[1](); });
    expect(requests).toHaveLength(2);
    expect(requests.map(({ path }) => new URL(path, "https://example.test").searchParams.get("postId"))).toEqual([posts[0].id, posts[1].id]);
    await act(async () => intersections[19]());
    expect(requests).toHaveLength(3);
    expect(requests.at(-1)?.path).toContain(posts[19].id);
    expect(writes()).toHaveLength(0);
  });

  it("uses a deliberate first tap to read when IntersectionObserver is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    await render();
    expect(requests).toHaveLength(0);
    await click("Cheer");
    expect(button("Cheer7").disabled).toBe(false);
    expect(writes()).toHaveLength(0);
    await click("Cheer7");
    expect(writes()).toHaveLength(1);
  });

  it("reads confirmed Cheers with a bearer and makes no automatic writes or comment reads", async () => {
    await render();
    expect(button("Cheer7").getAttribute("aria-pressed")).toBe("false");
    expect(writes()).toHaveLength(0);
    expect(requests.some(({ path }) => path.includes("view=comments"))).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toContain("view=summary");
    for (const { init } of requests) expect(new Headers(init.headers).get("authorization")).toBe("Bearer verified-session-token");
  });

  it("toggles through PUT and DELETE and reads counts back from the server", async () => {
    await render();
    await click("Cheer7");
    expect(button("Cheer8").getAttribute("aria-pressed")).toBe("true");
    await click("Cheer8");
    expect(button("Cheer7").getAttribute("aria-pressed")).toBe("false");
    expect(writes().map(({ init }) => init.method)).toEqual(["PUT", "DELETE"]);
    expect(requests.some(({ path }) => path.startsWith("/api/social/posts/"))).toBe(false);
    expect(JSON.parse(String(writes()[0].init.body))).toEqual({ action: "desired", postId: post.id, kind: "cheer" });
  });

  it("shows no invented zero on a failed summary and lets the reader retry", async () => {
    respond = (path) => path.includes("view=summary") ? Response.json({ error: "Read unavailable" }, { status: 503 }) : undefined;
    await render();
    expect(button("Cheer").disabled).toBe(true);
    expect(container.textContent).toContain("Read unavailable");
    respond = null;
    await click("Refresh Cheers");
    expect(button("Cheer7").disabled).toBe(false);
  });

  it("does not claim success for a malformed write or automatically repeat the change", async () => {
    await render();
    respond = (_path, init) => init.method === "PUT" ? Response.json({}) : undefined;
    await click("Cheer7");
    expect(container.textContent).toContain("could not be confirmed");
    expect(button("Cheer").disabled).toBe(true);
    await click("Refresh Cheers");
    expect(writes()).toHaveLength(1);
    expect(button("Cheer7").getAttribute("aria-pressed")).toBe("false");
  });

  it("reads approved comments with pagination and no invented total", async () => {
    respond = (path) => path.includes("view=comments") ? Response.json(path.includes("cursor=")
      ? { items: [comment("c1"), comment("c2", "Another evening")], nextCursor: null }
      : { items: [comment("c1")], nextCursor: "signed+cursor/==" }) : undefined;
    await render();
    await click("Comments");
    const postRead = requests.findIndex(({ path }) => path.startsWith("/api/social/posts/"));
    const commentRead = requests.findIndex(({ path }) => path.includes("view=comments"));
    expect(postRead).toBeGreaterThan(-1);
    expect(postRead).toBeLessThan(commentRead);
    for (const index of [postRead, commentRead]) {
      expect(new Headers(requests[index].init.headers).get("authorization")).toBe("Bearer verified-session-token");
    }
    expect(button("Comments").getAttribute("aria-expanded")).toBe("true");
    await click("More comments");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(requests.some(({ path }) => path.includes("cursor=signed%2Bcursor%2F%3D%3D"))).toBe(true);
  });

  it("keeps a failed comment and reuses its key on retry, then shows a review receipt", async () => {
    await render();
    await click("Comments");
    await type("My comment");
    respond = (_path, init) => init.method === "POST" ? Promise.reject(new Error("Connection lost")) : undefined;
    await click("Send comment");
    expect(container.querySelector("textarea")?.value).toBe("My comment");
    expect(container.textContent).toContain("Connection lost");
    respond = null;
    await click("Retry comment");
    const attempts = writes();
    expect(new Headers(attempts[0].init.headers).get("idempotency-key")).toBe(new Headers(attempts[1].init.headers).get("idempotency-key"));
    expect(new Headers(attempts[0].init.headers).get("authorization")).toBe("Bearer verified-session-token");
    expect(JSON.parse(String(attempts[0].init.body))).toEqual({ action: "comment", postId: post.id, body: "My comment" });
    expect(container.querySelector("textarea")?.value).toBe("");
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toContain("Comment received. It will appear after review.");
  });

  it("latches duplicate send taps and retains the draft until the server answers", async () => {
    let finish!: (response: Response) => void;
    respond = (_path, init) => init.method === "POST" ? new Promise<Response>((resolve) => { finish = resolve; }) : undefined;
    await render();
    await click("Comments");
    await type("My comment");
    await act(async () => { button("Send comment").click(); button("Send comment").click(); });
    expect(writes()).toHaveLength(1);
    expect(container.querySelector("textarea")?.readOnly).toBe(true);
    expect(container.querySelector("textarea")?.value).toBe("My comment");
    await act(async () => finish(Response.json({ comment: comment("new", "My comment", "pending") }, { status: 202 })));
    expect(container.textContent).toContain("after review");
  });

  it("reads comments while locked and hides the composer", async () => {
    currentPost.commentPolicy = "locked";
    await render();
    await click("Comments");
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Comments are closed.");
  });

  it("respects a newer locked policy and a server refusal for mutual-only comments", async () => {
    currentPost.commentPolicy = "friends";
    await render();
    await click("Comments");
    expect(container.textContent).toContain("Only mutuals can comment.");
    await type("Hello");
    respond = (_path, init) => init.method === "POST" ? Response.json({ error: "Comments are closed for this post." }, { status: 403 }) : undefined;
    await click("Send comment");
    expect(container.querySelector("textarea")?.value).toBe("Hello");
    currentPost = { ...currentPost, commentPolicy: "locked" };
    await click("Refresh comments");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("does not interpret a missing post as empty interactions", async () => {
    respond = (path) => path.startsWith("/api/social/posts/") ? Response.json({ error: "Post not found." }, { status: 404 }) : undefined;
    await render();
    await click("Comments");
    expect(container.textContent).toContain("Post not found.");
    expect(container.textContent).not.toContain("No comments to show yet.");
    expect(container.querySelector("textarea")).toBeNull();
    expect(requests.some(({ path }) => path.includes("view=comments"))).toBe(false);
  });

  it("clears drafts and ignores late comments after an account switch", async () => {
    await render();
    await click("Comments");
    await type("Private draft");
    let finish!: (response: Response) => void;
    respond = (path) => path.includes("view=comments") ? new Promise<Response>((resolve) => { finish = resolve; }) : undefined;
    await click("Refresh comments");
    auth.accountRevision++;
    auth.user = { id: "account-b" };
    await render();
    await act(async () => finish(Response.json({ items: [comment("late", "Previous account")], nextCursor: null })));
    expect(container.textContent).not.toContain("Previous account");
    expect(container.querySelector("textarea")).toBeNull();
    expect(button("Comments").getAttribute("aria-expanded")).toBe("false");
  });

  it("removes previously read comments when visibility is lost during pagination", async () => {
    respond = (path) => path.includes("view=comments") ? Response.json({ items: [comment("c1")], nextCursor: "next-page" }) : undefined;
    await render();
    await click("Comments");
    expect(container.querySelectorAll("li")).toHaveLength(1);
    respond = (path) => path.startsWith("/api/social/posts/") ? Response.json({ error: "Post not found." }, { status: 404 }) : undefined;
    await click("More comments");
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelector("textarea")).toBeNull();
    expect(button("Cheer").disabled).toBe(true);
    respond = null;
    await click("Retry comments");
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(requests.filter(({ path }) => path.includes("view=comments")).at(-1)?.path).not.toContain("cursor=");
  });

  it("rejects unapproved comments in a malformed reader reply and allows a clean retry", async () => {
    respond = (path) => path.includes("view=comments") ? Response.json({ items: [comment("pending", "Not public", "pending")], nextCursor: null }) : undefined;
    await render();
    await click("Comments");
    expect(container.textContent).not.toContain("Not public");
    expect(container.querySelector("textarea")).toBeNull();
    respond = null;
    await click("Retry comments");
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("makes no requests until identity resolves and offers sign-in only after sign-out resolves", async () => {
    auth.user = null;
    auth.identityResolved = false;
    auth.providerAuthState = "loading";
    await render();
    expect(requests).toHaveLength(0);
    expect(container.textContent).toBe("");
    auth.providerAuthState = "signed-out";
    await render();
    expect(container.querySelector("a")?.textContent).toBe("Sign in to interact");
    expect(requests).toHaveLength(0);
  });

  it("opens the Report control without writing and offers only the existing server reasons", async () => {
    await render();
    const before = requests.length;
    await openReport();
    expect(container.querySelector("details")?.open).toBe(true);
    expect(button("Report post").disabled).toBe(true);
    expect([...container.querySelectorAll("option")].map(option => option.value)).toEqual([
      "", "harassment", "hate", "threat", "doxxing", "spam", "other",
    ]);
    await chooseReportReason("doxxing");
    expect(requests).toHaveLength(before);
    await click("Report post");
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(String(writes()[0].init.body))).toEqual({ action: "report", kind: "post", id: post.id, reason: "doxxing" });
    expect(new Headers(writes()[0].init.headers).get("authorization")).toBe("Bearer verified-session-token");
    expect(container.textContent).toContain("Report received.");
    expect(button("Report post").disabled).toBe(true);
  });

  it("keeps the selected report reason after a server refusal and retries the same request", async () => {
    await render();
    await openReport();
    await chooseReportReason("spam");
    respond = (_path, init) => init.method === "POST" ? Response.json({ error: "Content not found." }, { status: 404 }) : undefined;
    await click("Report post");
    expect(container.textContent).not.toContain("Report received.");
    expect(container.textContent).toContain("Content not found.");
    expect(container.querySelector("select")?.value).toBe("spam");
    respond = null;
    await click("Retry report");
    expect(writes()).toHaveLength(2);
    expect(writes()[0].init.body).toBe(writes()[1].init.body);
    expect(container.textContent).toContain("Report received.");
  });

  it("does not treat a malformed report reply as success", async () => {
    await render();
    await openReport();
    await chooseReportReason("other");
    respond = (_path, init) => init.method === "POST" ? Response.json({ ok: true }, { status: 202 }) : undefined;
    await click("Report post");
    expect(container.textContent).toContain("The report could not be confirmed.");
    expect(container.textContent).not.toContain("Report received.");
  });

  it("latches duplicate report taps and ignores a late receipt after an account switch", async () => {
    let finish!: (response: Response) => void;
    respond = (_path, init) => init.method === "POST" ? new Promise<Response>((resolve) => { finish = resolve; }) : undefined;
    await render();
    await openReport();
    await chooseReportReason("harassment");
    await act(async () => { button("Report post").click(); button("Report post").click(); });
    expect(writes()).toHaveLength(1);
    expect(container.querySelector("select")?.disabled).toBe(true);
    auth.accountRevision++;
    await render();
    await act(async () => finish(Response.json({ report: { id: "report-1", createdAt: post.createdAt } }, { status: 202 })));
    expect(container.textContent).not.toContain("Report received.");
    expect(container.querySelector("details")?.open).toBe(false);
  });
});
