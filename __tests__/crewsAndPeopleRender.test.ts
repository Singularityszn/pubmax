// What the new surfaces render, and what they refuse to render.
//
// Three separate promises are pinned here:
//  1. Crews are behind the Social gate. With PUBMAX_SOCIAL_FRIENDS_LAUNCH off,
//     nothing user-reachable about a crew may exist on any page.
//  2. The follow control says where a friendship stands, so "Mates" and
//     "Following" are never the same pixels.
//  3. A profile statistic is a way in, not a number in a box.

// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  identityResolved: false,
  accountRevision: 1,
  user: null as { id: string } | null,
}));
const transport = vi.hoisted(() => ({ action: vi.fn(), identity: vi.fn() }));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/lib/authedFetch", () => ({
  authedFetch: transport.action,
  authedActionFetch: transport.action,
}));
vi.mock("@/lib/currentIdentityRead", () => ({ readAuthedIdentity: transport.identity }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));

import CrewsPanel from "@/components/social/CrewsPanel";
import FollowButton from "@/components/profile/FollowButton";
import ProfileHeader from "@/components/profile/ProfileHeader";
import type { Profile, ProfileStats } from "@/lib/profiles";

import CrewDetailClient from "@/app/social/crews/[crewId]/CrewDetailClient";
import { useFoundingMembership } from "@/components/founding/useFoundingMembership";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  auth.identityResolved = false;
  auth.user = null;
  transport.action.mockReset();
  transport.identity.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(element: ReactElement): Promise<void> {
  await act(async () => { root.render(element); });
}

function Membership() {
  const membership = useFoundingMembership();
  return createElement("output", null, membership.state, ":", membership.number);
}

describe("crews stay behind the Social gate", () => {
  it("waits for live identity before reading access or crews", async () => {
    auth.user = { id: "account-a" };
    await mount(createElement(CrewsPanel, { resolveAccess: true }));
    expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading your crews");
    expect(host.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).not.toContain("Try again");
    expect(transport.action).not.toHaveBeenCalled();
  });

  it("offers signed-out readers sign-in without reading protected data", async () => {
    auth.identityResolved = true;
    await mount(createElement(CrewsPanel, { resolveAccess: true }));
    expect(host.querySelector("a")?.textContent).toBe("Sign in");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/login?mode=signin&from=%2Fsocial");
    expect(host.querySelector("button")).toBeNull();
    expect(transport.action).not.toHaveBeenCalled();
  });

  it.each(["preview", "refused"])("hides crews when Social answers %s", async (state) => {
    auth.identityResolved = true;
    auth.user = { id: "account-a" };
    transport.action.mockResolvedValue(Response.json({ state }, { status: state === "refused" ? 403 : 200 }));
    await mount(createElement(CrewsPanel, { resolveAccess: true }));
    expect(host.textContent).toBe("");
    expect(transport.action.mock.calls.map(([url]) => url)).toEqual(["/api/social/access"]);
  });

  it("shows the empty state only after verified access and a successful list read", async () => {
    auth.user = { id: "account-a" };
    let resolveAccess!: (value: Response) => void;
    const access = new Promise<Response>((resolve) => { resolveAccess = resolve; });
    transport.action.mockImplementation((url: string) => url === "/api/social/access"
      ? access : Promise.resolve(Response.json({ items: [], nextCursor: null })));
    await mount(createElement(CrewsPanel, { resolveAccess: true }));
    expect(transport.action).not.toHaveBeenCalled();
    auth.identityResolved = true;
    await mount(createElement(CrewsPanel, { resolveAccess: true }));
    expect(host.textContent).toBe("");
    expect(transport.action.mock.calls.map(([url]) => url)).toEqual(["/api/social/access"]);
    await act(async () => { resolveAccess(Response.json({ state: "verified" })); });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("No crews yet. Start one and your lot can join the night.");
    expect(host.querySelector("button")?.textContent).toBe("Start a crew");
    expect(transport.action.mock.calls.map(([url]) => url)).toEqual(["/api/social/access", "/api/social/crews"]);
  });

  it("still waits for identity when its parent already verified access", async () => {
    auth.user = { id: "account-a" };
    transport.action.mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    await mount(createElement(CrewsPanel));
    expect(transport.action).not.toHaveBeenCalled();
    auth.identityResolved = true;
    await mount(createElement(CrewsPanel));
    expect(transport.action.mock.calls.map(([url]) => url)).toEqual(["/api/social/crews"]);
    expect(host.textContent).toContain("No crews yet.");
  });

  it("renders a crew from a successful list read", async () => {
    auth.identityResolved = true;
    auth.user = { id: "account-a" };
    transport.action.mockResolvedValue(Response.json({ items: [{
      kind: "member", crewId: "50000000-0000-4000-8000-000000000001",
      title: "Friday in Camden", phase: "planning", nightArea: "camden",
      startsAt: "2026-08-07T18:30:00.000Z",
      viewer: { memberId: "30000000-0000-4000-8000-000000000001", role: "owner" },
    }], nextCursor: null }));
    await mount(createElement(CrewsPanel));
    const link = host.querySelector('a[href^="/social/crews/"]');
    expect(link?.textContent).toContain("Friday in Camden");
    expect(link?.getAttribute("href")).toBe("/social/crews/50000000-0000-4000-8000-000000000001");
    expect(host.textContent).not.toContain("No crews yet.");
  });

  it("offers retry after a failed list read instead of claiming there are no crews", async () => {
    auth.identityResolved = true;
    auth.user = { id: "account-a" };
    transport.action.mockResolvedValue(Response.json({}, { status: 503 }));
    await mount(createElement(CrewsPanel));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load your crews.");
    expect(host.textContent).not.toContain("No crews yet.");
    transport.action.mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Try again");
    expect(retry).toBeDefined();
    await act(async () => { retry!.click(); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("No crews yet.");
  });

  it("holds the crew detail read until identity resolves and preserves a refusal", async () => {
    transport.action.mockResolvedValue(Response.json({}, { status: 403 }));
    const detail = () => createElement(CrewDetailClient, { crewId: "50000000-0000-4000-8000-000000000001", invitationId: null });
    await mount(detail());
    expect(transport.action).not.toHaveBeenCalled();
    auth.identityResolved = true;
    await mount(detail());
    expect(transport.action).toHaveBeenCalled();
    expect(host.textContent).not.toContain("Who is in");
    expect(host.textContent).not.toContain("Leave this crew");
  });

  it("reads founding membership only for a settled signed-in identity", async () => {
    transport.identity.mockResolvedValue({ ok: true, body: { foundingMemberNumber: 7 } });
    await mount(createElement(Membership));
    expect(host.textContent).toBe("loading:");
    auth.user = { id: "account-a" };
    await mount(createElement(Membership));
    expect(transport.identity).not.toHaveBeenCalled();
    auth.identityResolved = true;
    await mount(createElement(Membership));
    expect(transport.identity).toHaveBeenCalledWith("account-a");
    expect(host.textContent).toBe("member:7");
  });
});

describe("the follow control says where the friendship stands", () => {
  function markup(props: {
    initialFollowing: boolean;
    followsViewer?: boolean;
  }): string {
    return renderToStaticMarkup(
      createElement(FollowButton, {
        targetHandle: "sam",
        followerHandle: "alice",
        ...props,
      }),
    );
  }

  it("calls a two-sided follow Mates, and says so", () => {
    const html = markup({ initialFollowing: true, followsViewer: true });
    expect(html).toContain("Mates");
    expect(html).toContain("You follow each other");
  });

  it("keeps a one-sided follow honestly one-sided", () => {
    const html = markup({ initialFollowing: true, followsViewer: false });
    expect(html).toContain("Following");
    expect(html).not.toContain("Mates");
    expect(html).toMatch(/haven(?:'|&#x27;)t followed back/);
  });

  it("shows a pending mate the follow-back move and names the hint", () => {
    const html = markup({ initialFollowing: false, followsViewer: true });
    expect(html).toContain("Follow back");
    expect(html).toContain("Follows you");
  });

  it("says nothing extra when there is no edge either way", () => {
    const html = markup({ initialFollowing: false });
    expect(html).toContain(">Follow<");
    expect(html).not.toContain("Follows you");
    expect(html).not.toContain("Mates");
  });

  it("carries what the tap does in the accessible name", () => {
    expect(markup({ initialFollowing: true, followsViewer: true })).toMatch(
      /aria-label="[^"]*no longer be mates/,
    );
  });

  it("still defaults to the old one-edge behaviour when nobody passes the mirror", () => {
    // The prop is optional so every existing caller keeps compiling; the
    // default must be the cautious one, never a claimed mutual.
    expect(markup({ initialFollowing: true })).not.toContain("Mates");
  });
});

describe("profile statistics are ways in", () => {
  const profile: Profile = {
    handle: "sam",
    displayName: "Sam",
    homeCity: "London",
    bio: "",
    avatarUrl: "",
    coverUrl: "",
  } as Profile;

  const stats: ProfileStats = {
    pintsLogged: 12,
    cheapestPintGbp: 4.2,
    pubsVisited: 5,
    boroughs: [],
    beers: 3,
  } as unknown as ProfileStats;

  const html = renderToStaticMarkup(
    createElement(ProfileHeader, {
      profile,
      stats,
      followers: 14,
      following: 9,
      crawls: 3,
      memories: 2,
      sectionLinks: { timeline: true, crawls: true, memories: true },
    }),
  );

  it("links every one of the six tiles", () => {
    const tiles = html.match(/class="profileStat"/g) ?? [];
    const links = html.match(/<a[^>]*class="profileStatLink"/g) ?? [];
    expect(tiles).toHaveLength(6);
    expect(links).toHaveLength(6);
  });

  it("points each tile at the surface that holds what it counts", () => {
    expect(html).toContain('href="/u/sam/people/followers"');
    expect(html).toContain('href="/u/sam/people/following"');
    expect(html).toContain('href="/u/sam#timeline"');
    expect(html).toContain('href="/u/sam#crawl-stories"');
    expect(html).toContain('href="/u/sam#night-memories"');
  });

  it("says where a tile goes in its accessible name, since a bare figure cannot", () => {
    expect(html).toMatch(/aria-label="Followers: 14\. See who follows this handle\."/);
    expect(html).toMatch(/aria-label="Pints logged: 12\./);
  });

  it("keeps the label and the figure as the only visible text", () => {
    expect(html).toContain(
      '<span class="profileStatLabel">Followers</span><strong class="profileStatValue">14</strong>',
    );
  });
});
