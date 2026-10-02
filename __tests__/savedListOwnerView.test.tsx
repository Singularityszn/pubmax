// @vitest-environment jsdom

// A suspended account is withdrawn from public view, but its own list page
// still shows it the venues and follower count it owns. Everybody else reads
// the list the way they would read a handle nobody owns.

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
      request.headers.get("authorization") === `Bearer ${session.userId}` ? session.userId : null,
  };
});
vi.mock("@/lib/authedFetch", () => {
  const withBearer = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (session.userId) headers.set("authorization", `Bearer ${session.userId}`);
    return fetch(input, { ...init, headers });
  };
  return { authedFetch: withBearer, authedActionFetch: withBearer };
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
import { GET as getSavedPubs } from "@/app/api/saved-pubs/route";
import SavedListPage from "@/app/u/[handle]/lists/[listType]/page";
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
import { getVenueIndex } from "@/lib/venueIndex";

const LIST = "Date night";
let venueName = "";
let host: HTMLElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.viewer = "";
  session.userId = null;
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();
  __resetMemorySavedPubs();
  __resetMemorySavedListFollows();

  const venue = [...(await getVenueIndex()).values()][0]!;
  venueName = venue.name;
  const suspended = __seedMemoryOwnedProfile("suspendedbob", "user-suspended");
  __seedMemoryOwnedProfile("sam", "user-sam");
  await memorySavedPubsStore.toggleSaved({ handle: "suspendedbob", venueId: venue.id, listType: LIST });
  await savedListFollowsStore().followList("sam", "suspendedbob", LIST);
  __setMemoryProfileWithdrawn(suspended.id, true);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), "http://localhost"), init);
      const { pathname } = new URL(request.url);
      if (pathname === "/api/saved-pubs") return getSavedPubs(request);
      if (pathname === "/api/saved-pubs/list-follows") return getListFollows(request);
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

async function visitList(): Promise<string> {
  const page = await SavedListPage({
    params: Promise.resolve({ handle: "suspendedbob", listType: encodeURIComponent(LIST) }),
  });
  const detail = page.props.children[1].props.children;
  expect(detail.props.venues).toEqual([]);
  await act(async () => {
    root.render(createElement(SavedListDetail, detail.props));
  });
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return host.textContent ?? "";
}

describe("a suspended owner's saved list page", () => {
  it("shows the owner its own venues and followers", async () => {
    session.viewer = "suspendedbob";
    session.userId = "user-suspended";

    const text = await visitList();

    expect(text).toContain(venueName);
    expect(text).toContain("1 venue");
    expect(text).toContain("1 follower");
    expect(text).not.toContain("has not saved any venues");
  });

  it("shows another account the list of a handle nobody owns", async () => {
    session.viewer = "sam";
    session.userId = "user-sam";

    const text = await visitList();

    expect(text).not.toContain(venueName);
    expect(text).toContain("@suspendedbob has not saved any venues to this list yet.");
    expect(text).toContain("0 followers");
  });
});
