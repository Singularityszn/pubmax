// @vitest-environment jsdom

// Local API-to-profile proof. jsdom cannot prove browser geometry or native speech.

import { act, createElement, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/components/profile/PubmaxxAccountHub", () => ({
  default: () => createElement("div", null, "account hub"),
}));
vi.mock("@/components/wanted/WantedList", () => ({
  default: () => createElement("div", null, "wanted list"),
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNavMore", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined, prefetch: () => undefined }),
  usePathname: () => "/u/test",
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    prefetch?: boolean;
    [key: string]: unknown;
  }) => {
    void _prefetch;
    return createElement("a", { href, ...props }, children);
  },
}));

const session = vi.hoisted(() => ({
  user: null as { id: string } | null, handle: "", revision: 0, resolved: true,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    accountRevision: session.revision,
    user: session.user,
    handle: session.handle || null,
    configured: true,
    identityResolved: session.resolved,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: session.user ? "signed-in" : "signed-out",
    signedIn: Boolean(session.user),
    signedOut: !session.user,
    unresolved: !session.resolved,
  }),
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => (session.user ? session.handle : null),
}));
vi.mock("@/lib/useSocialFriendsLaunch", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/useSocialFriendsLaunch")>(),
  useSocialFriendsLaunch: () => true,
}));
vi.mock("@/lib/authClient", () => ({
  getAccessToken: async () => session.user ? `local-token-${session.user.id}` : null,
}));
vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) => {
    const bearer = request.headers.get("authorization");
    return bearer?.startsWith("Bearer local-token-")
      ? bearer.slice("Bearer local-token-".length) : null;
  },
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/components/profile/ProfileTimeline", () => ({
  default: () => null,
}));

import ProfilePageClient from "@/app/u/[handle]/ProfilePageClient";
import { GET } from "@/app/api/pint-drops/route";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import { clearSurfaceCache, readSurfaceSnapshot, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { __resetMemoryFollows, memoryFollowStore } from "@/lib/followStore";

const author = "local_geography_profile";
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clearSurfaceCache();
  __resetPintDrops();
  __resetMemoryProfiles();
  __resetMemoryFollows();
  Object.assign(session, { user: null, handle: "", revision: 0, resolved: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearSurfaceCache();
  __resetPintDrops();
  __resetMemoryProfiles();
  __resetMemoryFollows();
  vi.unstubAllGlobals();
});

it.each(["owner", "mutual"])("renders both permitted lifetime areas for the signed-in %s", async (viewer) => {
  __seedMemoryOwnedProfile(author, "local-owner");
  const mate = "local_geography_mate";
  __seedMemoryOwnedProfile(mate, "local-mate");
  await memoryFollowStore.follow(author, mate);
  await memoryFollowStore.follow(mate, author);
  session.user = { id: viewer === "owner" ? "local-owner" : "local-mate" };
  session.handle = viewer === "owner" ? author : mate;
  for (let i = 0; i <= 500; i++) {
    addPintDrop({
      id: `signed-in-geography-${i}`, handle: author,
      venueId: i === 0 ? "venue-eltcmh" : "venue-wrpmzq",
      drink: "", priceGbp: null, passedDownNote: "Disposable local fixture", era: "",
      provenance: "anecdote", status: "visible", visibility: i === 0 ? "public" : "friends",
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    });
  }
  const apiUrl = `http://localhost/api/pint-drops?author=${author}`;
  const authenticated = await GET(new Request(apiUrl, {
    headers: { authorization: `Bearer local-token-${session.user.id}` },
  }));
  const permitted = await authenticated.json();
  expect(permitted.drops).toHaveLength(500);
  expect(permitted.passportAreas).toEqual(["City of London", "Hackney"]);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/pint-drops") return GET(new Request(url, init));
    if (url.pathname === `/api/profiles/${author}`) return new Response(JSON.stringify({
      profile: { id: "local-profile", handle: author, displayName: "Local", visibility: "public" },
      projection: "full", socialLinks: [], counts: { followers: 1, following: 1 },
      viewerFollowing: viewer === "mutual", followsViewer: viewer === "mutual",
    }));
    if (url.pathname === "/api/crawls") return new Response(JSON.stringify({ crawls: [], total: 0 }));
    if (url.pathname.startsWith("/api/")) return new Response("{}");
    throw new Error("Local fixture forbids provider/network calls");
  }));
  const params = Promise.resolve({ handle: author });
  const render = async () => act(async () => {
    root.render(createElement(Suspense, { fallback: null }, createElement(ProfilePageClient, { params })));
  });
  await render();
  const areaStat = [...host.querySelectorAll(".passportStat")].find(
    (node) => node.querySelector(".passportStatLabel")?.textContent === "Boroughs + City",
  );
  expect(areaStat?.querySelector(".passportStatValue")?.textContent).toBe("2");
  expect(host.querySelector(".passportBoroughs")?.textContent)
    .toBe("Boroughs + City crossed: City of London · Hackney");

  // Restoring and changing the viewer must refresh the same mounted profile.
  const signedInUser = session.user;
  const signedInHandle = session.handle;
  Object.assign(session, { user: null, handle: "", revision: 1 });
  await render();
  expect(host.querySelector(".passportBoroughs")?.textContent)
    .toBe("Boroughs + City crossed: City of London");
  expect(readSurfaceSnapshot<{ passportAreas: string[] }>(`/api/pint-drops?author=${author}`)?.passportAreas)
    .toEqual(["City of London"]);

  Object.assign(session, { user: signedInUser, handle: signedInHandle, revision: 2, resolved: false });
  await render();
  expect(host.querySelector(".passportBoroughs")?.textContent ?? "").not.toContain("Hackney");
  session.resolved = true;
  await render();
  expect(host.querySelector(".passportBoroughs")?.textContent)
    .toBe("Boroughs + City crossed: City of London · Hackney");
  expect(readSurfaceSnapshot<{ passportAreas: string[] }>(`/api/pint-drops?author=${author}`)?.passportAreas)
    .toEqual(["City of London"]);

  __seedMemoryOwnedProfile("local_geography_outsider", "local-outsider");
  Object.assign(session, {
    user: { id: "local-outsider" }, handle: "local_geography_outsider", revision: 3,
  });
  await render();
  expect(host.querySelector(".passportBoroughs")?.textContent)
    .toBe("Boroughs + City crossed: City of London");
});

it("renders complete lifetime geography from the real author API after rejecting an old cached timeline", async () => {
  for (let i = 0; i < 502; i++) {
    addPintDrop({
      id: `profile-geography-${i}`, handle: author,
      venueId: i === 0 ? "venue-eltcmh" : i === 1 ? "venue-wrpmzq" : "venue-1pfnt71",
      drink: "", priceGbp: null, passedDownNote: "Disposable local fixture", era: "",
      provenance: "anecdote", status: "visible", visibility: "public",
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    });
  }
  writeSurfaceSnapshot(`/api/pint-drops?author=${author}`, { drops: [] });
  const json = (body: unknown) => new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
  let finishProfileRead!: () => void;
  const profileRead = new Promise<void>((resolve) => { finishProfileRead = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/pint-drops") {
      const response = await GET(new Request(url));
      finishProfileRead();
      return response;
    }
    if (url.pathname === `/api/profiles/${author}`) return json({
      profile: { id: "local-profile", handle: author, displayName: "Local", visibility: "public" },
      projection: "full", socialLinks: [], counts: { followers: 0, following: 0 },
      viewerFollowing: false, followsViewer: false,
    });
    if (url.pathname === "/api/crawls") return json({ crawls: [], total: 0 });
    if (url.pathname.startsWith("/api/")) return json({});
    throw new Error("Local fixture forbids provider/network calls");
  }));
  const params = Promise.resolve({ handle: author });
  await act(async () => {
    root.render(createElement(Suspense, { fallback: null }, createElement(ProfilePageClient, { params })));
  });
  await act(async () => { await profileRead; });
  const areaStat = [...host.querySelectorAll(".passportStat")].find(
    (node) => node.querySelector(".passportStatLabel")?.textContent === "Boroughs + City",
  );
  expect(areaStat?.querySelector(".passportStatValue")?.textContent).toBe("3");
  expect(host.querySelector(".passportBoroughs")?.textContent)
    .toBe("Boroughs + City crossed: Camden · City of London · Hackney");
});
