// @vitest-environment jsdom

// A suspended account is withdrawn from public view, but it still sees the
// lists it follows as followed. The list detail's follow-state read carries the
// viewer's bearer so the list-follows route can tell the owner from the public.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const session = vi.hoisted(() => ({
  viewer: "",
  userId: null as string | null,
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
  useAuth: () => ({ accountRevision: 0, user: session.userId ? { id: session.userId } : null }),
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => session.viewer || null,
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

import { GET as getListFollows } from "@/app/api/saved-pubs/list-follows/route";
import SavedListDetail from "@/components/profile/SavedListDetail";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { __resetMemorySavedListFollows, savedListFollowsStore } from "@/lib/savedPubsStore";

const LIST = "Date night";
let host: HTMLElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.viewer = "";
  session.userId = null;
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();
  __resetMemorySavedListFollows();

  const suspended = __seedMemoryOwnedProfile("suspendedbob", "user-suspended");
  __seedMemoryOwnedProfile("sam", "user-sam");
  __seedMemoryOwnedProfile("alice", "user-alice");
  await savedListFollowsStore().followList("suspendedbob", "sam", LIST);
  __setMemoryProfileWithdrawn(suspended.id, true);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), "http://localhost"), init);
      if (new URL(request.url).pathname === "/api/saved-pubs/list-follows") {
        return getListFollows(request);
      }
      return new Response("{}", { status: 404 });
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

async function followButton(): Promise<HTMLButtonElement | null> {
  await act(async () => {
    root.render(
      createElement(SavedListDetail, {
        ownerHandle: "sam",
        listType: LIST,
        venues: [],
        initialCounts: { followers: 0, savedPubs: 0 },
      }),
    );
  });
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return host.querySelector<HTMLButtonElement>("button.followBtn");
}

describe("a saved list's follow state", () => {
  it("shows a suspended viewer the list it already follows as followed", async () => {
    session.viewer = "suspendedbob";
    session.userId = "user-suspended";

    const button = await followButton();

    expect(button?.textContent).toBe("Following list");
    expect(host.textContent).toContain("1 follower");
  });

  it("does not tell another account that a suspended handle follows the list", async () => {
    session.viewer = "alice";
    session.userId = "user-alice";

    const button = await followButton();

    expect(button?.textContent).toBe("Follow list");
  });
});
