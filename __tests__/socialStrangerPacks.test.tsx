// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  accountRevision: 0,
  identityResolved: true,
  user: null as { id: string } | null,
}));

const viewerSession = vi.hoisted(() => ({
  current: {
    phase: "signed-out" as const,
    signedIn: false,
    signedOut: true,
    unresolved: false,
  },
}));

const transport = vi.hoisted(() => ({
  authedActionFetch: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/social",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState,
}));

vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => viewerSession.current,
}));

vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: transport.authedActionFetch,
}));

vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => true,
}));

vi.mock("@/lib/deviceAccountIdentity", () => ({
  subscribeDeviceIdentity: () => () => undefined,
}));

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/founding/FoundersWallLink", () => ({ default: () => null }));
vi.mock("@/components/profile/HandleAvatar", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => null }));
vi.mock("@/components/social/CreatorListsLane", () => ({ default: () => null }));
vi.mock("@/components/social/FindYourLot", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/app/discover/DiscoverPageClient", () => ({ DiscoverBody: () => null }));
vi.mock("@/app/social/SocialComposer", () => ({ default: () => null }));
vi.mock("@/app/social/SocialOutbox", () => ({ default: () => null }));
vi.mock("@/app/social/SocialTagInbox", () => ({ default: () => null }));

import SocialPageClient from "@/app/social/SocialPageClient";

const initialState = {
  valid: true as const,
  tab: "posts" as const,
  feed: "following" as const,
  area: null,
};

const publicPack = {
  slug: "camden",
  title: "Drinkers of Camden",
  description: "Accounts whose profile says Camden.",
  kind: "borough" as const,
  borough: "Camden",
  members: [{ handle: "alice" }],
  memberCount: 3,
};

function packResponse(): Response {
  return new Response(
    JSON.stringify({ packs: [publicPack], viewerFollowing: null }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.accountRevision = 0;
  authState.identityResolved = true;
  authState.user = null;
  viewerSession.current = {
    phase: "signed-out",
    signedIn: false,
    signedOut: true,
    unresolved: false,
  };
  transport.authedActionFetch.mockReset();
  transport.authedActionFetch.mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/starter-packs") return packResponse();
    throw new Error(`Unexpected request: ${String(input)}`);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("signed-out Social starter packs", () => {
  it("renders public pack cards beside one sign-in action without follow controls", async () => {
    await act(async () => {
      root.render(
        createElement(SocialPageClient, {
          initialState,
          rivalry: [],
          heritageCrawls: [],
        }),
      );
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    expect(host.querySelector(".socialBoundary")?.textContent).toContain(
      "Sign in to use Social.",
    );
    expect(host.querySelectorAll('a[href*="/login"]')).toHaveLength(1);
    expect(host.querySelectorAll(".starterPacks__card")).toHaveLength(1);
    expect(host.querySelectorAll(".starterPacks__follow")).toHaveLength(0);
    expect(host.querySelectorAll(".starterPacks__card button")).toHaveLength(0);
    expect(transport.authedActionFetch).toHaveBeenCalledWith(
      "/api/starter-packs",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
