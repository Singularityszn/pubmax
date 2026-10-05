// @vitest-environment jsdom

// A suspended (not banned) owner reads their own follow graph on
// /u/<self>/people/<relation> through the bearer. That answer belongs to one
// account: a sign-out or account switch on the same page must drop it and ask
// again as the new viewer, who gets the empty answer an unknown handle gets.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const session = vi.hoisted(() => ({
  viewerUserId: null as string | null,
  tokenOwnerUserId: null as string | null,
  phase: "signed-out" as "unresolved" | "signed-in" | "signed-out",
  accountRevision: 0,
  accountController: null as AbortController | null,
}));

vi.mock("@/lib/authProviderRevision", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authProviderRevision")>();
  return {
    ...actual,
    readProviderAccountRevision: () => session.accountRevision,
    readProviderIdentityRevision: () => session.accountRevision,
    readProviderAccountSignal: () => session.accountController!.signal,
  };
});

vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async (request: Request) =>
      session.tokenOwnerUserId && request.headers.get("authorization") === `Bearer token-${session.tokenOwnerUserId}`
        ? session.tokenOwnerUserId
        : null,
  };
});
vi.mock("@/lib/authClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authClient")>();
  return {
    ...actual,
    getAccessToken: async () => (session.tokenOwnerUserId ? `token-${session.tokenOwnerUserId}` : null),
  };
});
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    accountRevision: session.accountRevision,
    user: session.viewerUserId ? { id: session.viewerUserId } : null,
  }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: session.phase,
    signedIn: session.phase === "signed-in",
    signedOut: session.phase === "signed-out",
    unresolved: session.phase === "unresolved",
  }),
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

import { GET as getFollowing } from "@/app/api/profiles/[handle]/following/route";
import { GET as getLot } from "@/app/api/profiles/[handle]/lot/route";
import PeopleListClient from "@/app/u/[handle]/people/[relation]/PeopleListClient";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

type PendingProfileRead = {
  request: Request;
  resolve: (response: Response) => void;
};

let holdProfileReads = false;
const pendingProfileReads: PendingProfileRead[] = [];

async function answerProfileRead(request: Request): Promise<Response> {
  const match = /^\/api\/profiles\/([^/]+)\/(following|lot)$/.exec(new URL(request.url).pathname);
  if (!match) return new Response("{}", { status: 404 });
  const context = { params: Promise.resolve({ handle: decodeURIComponent(match[1]!) }) };
  return match[2] === "lot" ? getLot(request, context) : getFollowing(request, context);
}

async function releaseHeldProfileReads(): Promise<void> {
  holdProfileReads = false;
  const pending = pendingProfileReads.splice(0);
  for (const entry of pending) entry.resolve(await answerProfileRead(entry.request));
}

function setViewerState(
  viewerUserId: string | null,
  tokenOwnerUserId: string | null,
  phase: "unresolved" | "signed-in" | "signed-out",
): void {
  session.accountController?.abort();
  session.accountController = new AbortController();
  session.accountRevision += 1;
  session.viewerUserId = viewerUserId;
  session.tokenOwnerUserId = tokenOwnerUserId;
  session.phase = phase;
}

let host: HTMLElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.accountController?.abort();
  session.accountController = new AbortController();
  session.viewerUserId = null;
  session.tokenOwnerUserId = null;
  session.phase = "signed-out";
  session.accountRevision = 0;
  holdProfileReads = false;
  pendingProfileReads.splice(0);
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  clearSurfaceCache();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();

  const suspended = __seedMemoryOwnedProfile("suspendedbob", "user-suspended");
  __seedMemoryOwnedProfile("alice", "user-alice");
  __seedMemoryOwnedProfile("sam", "user-sam");
  await followStore().follow("suspendedbob", "alice");
  await followStore().follow("alice", "suspendedbob");
  await followStore().follow("suspendedbob", "sam");
  __setMemoryProfileWithdrawn(suspended.id, true);

  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), "http://localhost"), init);
      if (!holdProfileReads) return answerProfileRead(request);
      return new Promise<Response>((resolve) => {
        pendingProfileReads.push({ request, resolve });
      });
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (pendingProfileReads.length > 0) await act(async () => releaseHeldProfileReads());
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function renderFollowing(): Promise<void> {
  await act(async () => {
    root.render(createElement(PeopleListClient, { handle: "suspendedbob", relation: "following" }));
  });
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function listedHandles(): string[] {
  return Array.from(host.querySelectorAll<HTMLAnchorElement>("a[href^='/u/']"))
    .map((link) => link.getAttribute("href") ?? "")
    .filter((href) => href !== "/u/suspendedbob");
}

describe("a suspended owner's people list at the account boundary", () => {
  it("shows the signed-in owner their own following", async () => {
    setViewerState("user-suspended", "user-suspended", "signed-in");

    await renderFollowing();

    expect(listedHandles().sort()).toEqual(["/u/alice", "/u/sam"]);
  });

  it("drops the owner's graph when the owner signs out on the page", async () => {
    setViewerState("user-suspended", "user-suspended", "signed-in");
    await renderFollowing();
    expect(listedHandles()).toHaveLength(2);

    setViewerState(null, "user-suspended", "signed-out");
    holdProfileReads = true;
    await renderFollowing();

    expect(listedHandles()).toEqual([]);
    expect(pendingProfileReads).toHaveLength(2);
    await act(async () => releaseHeldProfileReads());
    await renderFollowing();
    expect(listedHandles()).toEqual([]);
  });

  it("ignores owner response bodies that settle after sign-out", async () => {
    let releaseBodies!: () => void;
    const bodies = new Promise<void>((resolve) => { releaseBodies = resolve; });
    let heldOwnerBodies = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), "http://localhost"), init);
      const response = await answerProfileRead(request);
      if (request.headers.get("authorization") === "Bearer token-user-suspended") {
        const body = await response.json();
        heldOwnerBodies += 1;
        vi.spyOn(response, "json").mockImplementation(async () => {
          await bodies;
          return body;
        });
      }
      return response;
    }));
    try {
      setViewerState("user-suspended", "user-suspended", "signed-in");
      await renderFollowing();
      expect(heldOwnerBodies).toBe(2);
      expect(listedHandles()).toEqual([]);
      setViewerState(null, null, "signed-out");
      await renderFollowing();
      expect(listedHandles()).toEqual([]);
      await act(async () => { releaseBodies(); });
      await renderFollowing();
      expect(listedHandles()).toEqual([]);
      expect(host.querySelector(".peopleDir__self")).toBeNull();
    } finally {
      await act(async () => { releaseBodies(); });
    }
  });

  it("drops the owner's graph when another account signs in on the page", async () => {
    setViewerState("user-suspended", "user-suspended", "signed-in");
    await renderFollowing();
    expect(listedHandles()).toHaveLength(2);

    setViewerState("user-sam", "user-sam", "signed-in");
    await renderFollowing();

    expect(listedHandles()).toEqual([]);
  });
});
