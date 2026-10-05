// @vitest-environment jsdom

// A suspended (not banned) account is withdrawn from public view, so the list
// page's server render answers its lists as empty. Its signed-in owner still
// gets their own venues and follower count back through the owner-aware reads.

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

import { GET as getSavedPubs } from "@/app/api/saved-pubs/route";
import { GET as getListFollows } from "@/app/api/saved-pubs/list-follows/route";
import SavedListDetail from "@/components/profile/SavedListDetail";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import {
  __resetMemorySavedListFollows,
  __resetMemorySavedPubs,
  memorySavedPubsStore,
  savedListFollowsStore,
} from "@/lib/savedPubsStore";

const LIST = "Date night";
let host: HTMLElement;
let root: Root;
let requested: string[];

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.viewer = "";
  session.userId = null;
  requested = [];
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();
  __resetMemorySavedPubs();
  __resetMemorySavedListFollows();

  const suspended = __seedMemoryOwnedProfile("suspendedbob", "user-suspended");
  __seedMemoryOwnedProfile("alice", "user-alice");
  await memorySavedPubsStore.toggleSaved({
    handle: "suspendedbob",
    venueId: "venue-owner-read-1",
    listType: LIST,
  });
  await savedListFollowsStore().followList("alice", "suspendedbob", LIST);
  __setMemoryProfileWithdrawn(suspended.id, true);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), "http://localhost"), init);
      const path = new URL(request.url).pathname;
      requested.push(path);
      if (path === "/api/saved-pubs") return getSavedPubs(request);
      if (path === "/api/saved-pubs/list-follows") return getListFollows(request);
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

// The props are what the server render hands a withdrawn owner's list: the
// public read, which answers it as empty with no followers.
async function renderSuspendedList(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(SavedListDetail, {
        ownerHandle: "suspendedbob",
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
}

function venueRows(): number {
  return host.querySelectorAll(".listDetailItem").length;
}

describe("a suspended owner's saved list page", () => {
  it("shows the signed-in owner their own venues and follower count", async () => {
    session.viewer = "suspendedbob";
    session.userId = "user-suspended";

    await renderSuspendedList();

    expect(venueRows()).toBe(1);
    expect(host.textContent).not.toContain("has not saved any venues");
    expect(host.textContent).toContain("1 venue");
    expect(host.textContent).toContain("1 follower");
  });

  it("keeps the list empty for another signed-in account", async () => {
    session.viewer = "alice";
    session.userId = "user-alice";

    await renderSuspendedList();

    expect(venueRows()).toBe(0);
    expect(host.textContent).toContain("@suspendedbob has not saved any venues to this list yet.");
    expect(host.textContent).toContain("0 followers");
    expect(requested).not.toContain("/api/saved-pubs");
  });

  it("keeps the list empty for a signed-out viewer", async () => {
    await renderSuspendedList();

    expect(venueRows()).toBe(0);
    expect(requested).toEqual([]);
  });
});
