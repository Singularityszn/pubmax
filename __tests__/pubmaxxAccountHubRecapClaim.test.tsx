// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  accountRevision: 0,
  user: { id: "recap-owner-a" },
  session: { user: { id: "recap-owner-a" }, access_token: "account-token-a" },
  loading: false,
  identityResolved: true,
  configured: true,
  handle: null,
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/u/you",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => auth.session.access_token }));

import PubmaxxAccountHub from "@/components/profile/PubmaxxAccountHub";
import { forgetCurrentIdentityRead } from "@/lib/currentIdentityRead";
import { publishAuthActionState } from "@/lib/authedFetch";
import { readProviderIdentityRevision, setProviderAuthState, setProviderIdentity } from "@/lib/authProviderRevision";
import { clearPlanCapability, PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";
import { listPendingPlanRecaps, writePendingPlanRecap, type PendingPlanRecap } from "@/lib/planRecap";

const PLAN_A = "11111111-1111-4111-8111-111111111111";
const PLAN_B = "22222222-2222-4222-8222-222222222222";
const COMPLETION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPLETION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let host: HTMLDivElement;
let root: Root;
let mounted = false;
let posts: Array<{ path: string; init: RequestInit }>;
let save: (path: string, init: RequestInit) => Promise<Response>;

function draft(planId: string, completionId: string): PendingPlanRecap {
  return {
    version: 1, planId, completionId, title: "Private Thursday", ending: "get_home",
    endingSelection: null, completedAt: "2026-10-28T23:00:00.000Z", routeRevision: 1,
    savedAt: "2026-10-28T23:01:00.000Z",
    stops: [{ venueId: "venue-a", venueName: "First Pub", position: 0, caption: "A private pint" }],
  };
}

function saved(path: string): Response {
  return Response.json({
    private: true,
    memory: {
      id: path.includes(PLAN_A) ? "memory-a" : "memory-b",
      ownerId: "recap-owner-a",
      planCompletionId: path.includes(PLAN_A) ? COMPLETION_A : COMPLETION_B,
    },
    moments: [],
  }, { status: 201 });
}

async function mount(recaps = [draft(PLAN_A, COMPLETION_A)]) {
  for (const recap of recaps) writePendingPlanRecap(recap);
  await act(async () => root.render(createElement(PubmaxxAccountHub)));
  mounted = true;
  await vi.waitFor(() => expect(host.querySelector('[aria-labelledby="plan-recap-merge-title"]')).not.toBeNull());
}

async function choose(label: string) {
  await vi.waitFor(() => expect(host.querySelector('[aria-labelledby="plan-recap-merge-title"]')).not.toBeNull());
  const group = host.querySelector('[aria-labelledby="plan-recap-merge-title"]');
  const button = [...(group?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  localStorage.clear();
  forgetCurrentIdentityRead();
  clearPlanCapability(PLAN_A);
  clearPlanCapability(PLAN_B);
  auth.user = { id: "recap-owner-a" };
  auth.session = { user: auth.user, access_token: "account-token-a" };
  setProviderIdentity("supabase", auth.user.id);
  setProviderAuthState("supabase", "authenticated");
  auth.accountRevision = readProviderIdentityRevision();
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  posts = [];
  save = async (path) => saved(path);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init = {}) => {
    const raw = input instanceof Request ? input.url : String(input);
    const path = new URL(raw, "http://localhost").pathname;
    if (init.method === "POST") {
      posts.push({ path, init });
      return save(path, init);
    }
    if (path.endsWith("/session")) {
      return Response.json({ active: true, role: "host", collaborationAuthorized: true });
    }
    return Response.json({ handle: null, profile: null, pending: [], drafts: [], memories: [], memoryCompletionIds: [] });
  }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  else root.unmount();
  mounted = false;
  host.remove();
  clearPlanCapability(PLAN_A);
  clearPlanCapability(PLAN_B);
  forgetCurrentIdentityRead();
  setProviderIdentity("supabase", null);
  setProviderAuthState("supabase", "signed-out");
  publishAuthActionState({ status: "unknown", identityResolved: false });
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AccountHub's confirmed private recap claim", () => {
  it("keeps the draft and sends no write when the reader chooses keep-device", async () => {
    await mount();
    expect(posts).toEqual([]);
    await choose("Keep only on this device");
    expect(posts).toEqual([]);
    expect(listPendingPlanRecaps().map((recap) => recap.completionId)).toEqual([COMPLETION_A]);
  });

  it("sends the HttpOnly sentinel to the exact Plan path with the account bearer", async () => {
    await mount();
    expect(posts).toEqual([]);
    await choose("Bring this device");
    await vi.waitFor(() => expect(listPendingPlanRecaps()).toEqual([]));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.path).toBe(`/api/plans/${PLAN_A}/recap`);
    expect(new Headers(posts[0]?.init.headers).get("authorization")).toBe("Bearer account-token-a");
    expect(JSON.parse(String(posts[0]?.init.body))).toMatchObject({
      memberToken: PLAN_HTTP_ONLY_SESSION,
      recap: { planId: PLAN_A, completionId: COMPLETION_A },
    });
    expect(host.textContent).toContain("Your device recap is now a private Memory. Nothing was published.");
  });

  it("keeps every draft after a partial failure and retries the successful first save", async () => {
    let failSecond = true;
    save = async (path) => posts.length === 2 && failSecond
      ? Response.json({ error: "Try this recap again." }, { status: 503 })
      : saved(path);
    await mount([draft(PLAN_A, COMPLETION_A), draft(PLAN_B, COMPLETION_B)]);
    await choose("Bring this device");
    await vi.waitFor(() => expect(host.textContent).toContain("Try this recap again."));
    expect(listPendingPlanRecaps().map((recap) => recap.completionId).sort()).toEqual([COMPLETION_A, COMPLETION_B]);
    failSecond = false;
    await choose("Bring this device");
    await vi.waitFor(() => expect(listPendingPlanRecaps()).toEqual([]));
    expect(posts).toHaveLength(4);
    const expectedPaths = [`/api/plans/${PLAN_A}/recap`, `/api/plans/${PLAN_B}/recap`];
    expect(posts.slice(0, 2).map((entry) => entry.path).sort()).toEqual(expectedPaths);
    expect(posts.slice(2).map((entry) => entry.path).sort()).toEqual(expectedPaths);
  });

  it("waits for the account write gate before sending the confirmed recap", async () => {
    await mount();
    publishAuthActionState({ status: "unknown", identityResolved: false });
    await choose("Bring this device");
    expect(posts).toEqual([]);
    expect(listPendingPlanRecaps().map((recap) => recap.completionId)).toEqual([COMPLETION_A]);
    await act(async () => {
      publishAuthActionState({ status: "signed-in", identityResolved: true });
    });
    await vi.waitFor(() => expect(listPendingPlanRecaps()).toEqual([]));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.path).toBe(`/api/plans/${PLAN_A}/recap`);
  });

  it("continues under the captured owner when that owner's access token refreshes", async () => {
    let release: (response: Response) => void = () => {};
    save = async (path) => posts.length === 1
      ? new Promise<Response>((resolve) => { release = resolve; })
      : saved(path);
    await mount([draft(PLAN_A, COMPLETION_A), draft(PLAN_B, COMPLETION_B)]);
    await choose("Bring this device");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await act(async () => {
      auth.session = { user: auth.user, access_token: "refreshed-token-a" };
      setProviderIdentity("supabase", auth.user.id);
      setProviderAuthState("supabase", "authenticated");
      auth.accountRevision = readProviderIdentityRevision();
      root.render(createElement(PubmaxxAccountHub));
      release(saved(posts[0]!.path));
    });
    await vi.waitFor(() => expect(listPendingPlanRecaps()).toEqual([]));
    expect(posts).toHaveLength(2);
    expect(posts.map((entry) => new Headers(entry.init.headers).get("authorization")))
      .toEqual(["Bearer account-token-a", "Bearer refreshed-token-a"]);
  });

  it("keeps drafts after an authentication refusal and retries with the refreshed token", async () => {
    save = async (path) => posts.length === 1
      ? Response.json({ error: "Sign in again." }, { status: 401 })
      : saved(path);
    await mount([draft(PLAN_A, COMPLETION_A), draft(PLAN_B, COMPLETION_B)]);
    await choose("Bring this device");
    await vi.waitFor(() => expect(host.textContent).toContain("Sign in again."));
    expect(listPendingPlanRecaps()).toHaveLength(2);
    await act(async () => {
      auth.session = { user: auth.user, access_token: "refreshed-token-a" };
      root.render(createElement(PubmaxxAccountHub));
    });
    await choose("Bring this device");
    await vi.waitFor(() => expect(listPendingPlanRecaps()).toEqual([]));
    expect(posts.map((entry) => new Headers(entry.init.headers).get("authorization")))
      .toEqual(["Bearer account-token-a", "Bearer refreshed-token-a", "Bearer refreshed-token-a"]);
  });

  it("stops the batch and retains local drafts when the account changes during a save", async () => {
    let release: (response: Response) => void = () => {};
    save = async () => new Promise<Response>((resolve) => { release = resolve; });
    await mount([draft(PLAN_A, COMPLETION_A), draft(PLAN_B, COMPLETION_B)]);
    await choose("Bring this device");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await act(async () => {
      auth.user = { id: "recap-owner-b" };
      auth.session = { user: auth.user, access_token: "account-token-b" };
      setProviderIdentity("supabase", auth.user.id);
      auth.accountRevision = readProviderIdentityRevision();
      root.render(createElement(PubmaxxAccountHub));
      release(saved(posts[0]!.path));
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.init.signal?.aborted).toBe(true);
    expect(new Headers(posts[0]?.init.headers).get("authorization")).toBe("Bearer account-token-a");
    expect(listPendingPlanRecaps().map((recap) => recap.completionId).sort()).toEqual([COMPLETION_A, COMPLETION_B]);
    expect(host.textContent).not.toContain("Your device recaps are now private Memories.");
  });
});
