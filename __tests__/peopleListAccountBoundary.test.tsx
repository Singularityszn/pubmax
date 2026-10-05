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
  userId: null as string | null,
  accountRevision: 0,
}));

vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async (request: Request) =>
      session.userId && request.headers.get("authorization") === `Bearer token-${session.userId}`
        ? session.userId
        : null,
  };
});
vi.mock("@/lib/authClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authClient")>();
  return {
    ...actual,
    getAccessToken: async () => (session.userId ? `token-${session.userId}` : null),
  };
});
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    accountRevision: session.accountRevision,
    user: session.userId ? { id: session.userId } : null,
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

let host: HTMLElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.userId = null;
  session.accountRevision = 0;
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
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), "http://localhost"), init);
      const match = /^\/api\/profiles\/([^/]+)\/(following|lot)$/.exec(new URL(request.url).pathname);
      if (!match) return new Response("{}", { status: 404 });
      const context = { params: Promise.resolve({ handle: decodeURIComponent(match[1]!) }) };
      return match[2] === "lot" ? getLot(request, context) : getFollowing(request, context);
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
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
    session.userId = "user-suspended";

    await renderFollowing();

    expect(listedHandles().sort()).toEqual(["/u/alice", "/u/sam"]);
  });

  it("drops the owner's graph when the owner signs out on the page", async () => {
    session.userId = "user-suspended";
    await renderFollowing();
    expect(listedHandles()).toHaveLength(2);

    session.userId = null;
    session.accountRevision = 1;
    await renderFollowing();

    expect(listedHandles()).toEqual([]);
  });

  it("drops the owner's graph when another account signs in on the page", async () => {
    session.userId = "user-suspended";
    await renderFollowing();
    expect(listedHandles()).toHaveLength(2);

    session.userId = "user-sam";
    session.accountRevision = 1;
    await renderFollowing();

    expect(listedHandles()).toEqual([]);
  });
});
