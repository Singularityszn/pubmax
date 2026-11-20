// @vitest-environment jsdom

// A withdrawn account (banned in auth, or its Social account suspended) gets
// the same /api/profiles/<handle> answer as a handle nobody owns, so the page
// renders the same shell for both and never says the account existed.

import { act, createElement, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/profile/PubmaxxAccountHub", () => ({
  default: () => createElement("div", null, "account hub"),
}));
vi.mock("@/components/wanted/WantedList", () => ({
  default: () => createElement("div", null, "wanted list"),
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNavMore", () => ({ default: () => null }));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }));
const route = vi.hoisted(() => ({ pathname: "/u/test" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => router,
  usePathname: () => route.pathname,
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
  user: null as { id: string } | null,
  handle: "",
  revision: 0,
  identityResolved: true,
  identityUnavailable: false,
  retryIdentity: vi.fn(),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    accountRevision: session.revision,
    user: session.user,
    handle: session.handle || null,
    configured: true,
    identityResolved: session.identityResolved,
    identityUnavailable: session.identityUnavailable,
    retryIdentity: session.retryIdentity,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: session.user ? "signed-in" : "signed-out",
    signedIn: Boolean(session.user),
    signedOut: !session.user,
    unresolved: false,
  }),
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => (session.user ? session.handle : null),
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => true,
}));
const accessToken = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock("@/lib/authClient", () => ({ getAccessToken: accessToken }));

import ProfilePageClient from "@/app/u/[handle]/ProfilePageClient";
import ProfileNotFoundClient from "@/app/u/ProfileNotFoundClient";
import { clearSurfaceCache, loadSurfaceJson, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";
import { defined } from "@/__tests__/helpers/defined";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const LIVE_PROFILE = {
  id: "22222222-2222-4222-8222-222222222222",
  handle: "alice_pints",
  displayName: "Alice",
  visibility: "public",
  createdAt: "2026-06-01T12:00:00.000Z",
  updatedAt: "2026-08-10T09:00:00.000Z",
};

function profileAnswer(handle: string, headers: Headers): Response {
  const ownerProfile = handle === "suspendedbob" &&
    session.user?.id === "user-suspended" &&
    headers.get("authorization") === "Bearer token"
    ? { ...LIVE_PROFILE, handle: "suspendedbob", displayName: "Bob" }
    : null;
  return json({
    profile: handle === "alice_pints" ? LIVE_PROFILE : ownerProfile,
    projection: "full",
    socialLinks: [],
    counts: { followers: 0, following: 0 },
    viewerFollowing: false,
    followsViewer: false,
  });
}

let host: HTMLElement;
let root: Root;
let profileReadFails = false;
let aliasResponse: Promise<Response> | null = null;
let aliasNetworkFails = false;
let profileResponse: Promise<Response> | null = null;

async function visit(handle: string): Promise<string> {
  let threw: unknown;
  await act(async () => {
    try {
      root.render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(ProfilePageClient, { params: Promise.resolve({ handle }) }),
        ),
      );
    } catch (error) {
      threw = error;
    }
  });
  if (threw) throw threw;
  return host.textContent ?? "";
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.user = null;
  route.pathname = "/u/test";
  session.handle = "";
  session.revision = 0;
  session.identityResolved = true;
  session.identityUnavailable = false;
  session.retryIdentity.mockReset();
  accessToken.mockReset().mockResolvedValue("token");
  router.replace.mockClear();
  profileReadFails = false;
  aliasResponse = null;
  aliasNetworkFails = false;
  profileResponse = null;
  clearSurfaceCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const profileMatch = /^\/api\/profiles\/([^/]+)$/.exec(url.pathname);
      if (profileMatch) {
        if (profileReadFails) return json({ error: "Unavailable" }, 503);
        if (profileResponse) return profileResponse;
        return profileAnswer(decodeURIComponent(defined(profileMatch[1])), new Headers(init?.headers));
      }
      if (url.pathname === "/api/identity/handle/resolve") {
        if (aliasNetworkFails) throw new Error("offline");
        if (aliasResponse) return aliasResponse;
        return json({ error: { code: "NOT_FOUND", message: "Profile not found." } }, 404);
      }
      if (url.pathname === "/api/pint-drops") return json({ drops: [] });
      if (url.pathname === "/api/crawls") return json({ crawls: [], total: 0 });
      return json({});
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

describe("a withdrawn account's public profile page", () => {
  it.each([
    { lane: "public crawls", key: "/api/crawls?author=alice_pints&limit=10", path: "/api/crawls", snapshot: { count: 0, crawls: [] } },
    { lane: "this profile", key: "/api/profiles/alice_pints", path: "/api/profiles/alice_pints", snapshot: { profile: null } },
  ])("reports a failed $lane refresh despite a cached empty answer", async ({ lane, key, path, snapshot }) => {
    writeSurfaceSnapshot(key, snapshot);
    const previousFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === path) return json({}, 429);
      if (url.pathname === "/api/pint-drops") return json({ drops: [], passportAreas: [] });
      return previousFetch(input, init);
    }));
    await visit("alice_pints");
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain(`We couldn't check ${lane}.`));
    });
    if (lane === "this profile") expect(host.textContent).not.toContain("Claim this handle");
  });

  it.each([
    { lane: "saved venues", path: "/api/saved-pubs", own: false, answer: { saved: [{ venueId: "retry-arms", venueName: "The Retry Arms", venueMapUrl: "/map?sel=retry-arms", listType: "Favourites" }] }, result: "The Retry Arms" },
    { lane: "followed lists", path: "/api/saved-pubs/list-follows", own: false, answer: { followedLists: [{ ownerHandle: "sam", listType: "Retry List" }] }, result: "Retry List" },
    { lane: "public crawls", path: "/api/crawls", own: false, answer: { count: 1, crawls: [{ slug: "retry", title: "Retry crawl", stops: 2 }] }, result: "Retry crawl" },
    { lane: "your unlisted crawls", path: "/api/crawls", own: true, answer: { ownCount: 1, unlistedTotal: 1, unlisted: [{ slug: "retry-hidden", title: "Retry hidden crawl", stops: 2 }] }, result: "Retry hidden crawl" },
    { lane: "this profile", path: "/api/profiles/alice_pints", own: false, answer: { profile: { ...LIVE_PROFILE, displayName: "Alice recovered" }, projection: "full" }, result: "Alice recovered" },
  ])("preserves a failed $lane read and recovers on retry", async ({ lane, path, own, answer, result }) => {
    session.user = { id: "owner-1" };
    session.handle = "alice_pints";
    let failed = true;
    let finishRetry: ((response: Response) => void) | undefined;
    const previousFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const matches = url.pathname === path && (path !== "/api/crawls" || (url.searchParams.get("scope") === "own") === own);
      if (matches) {
        if (failed) return json({}, 429);
        return new Promise<Response>((resolve) => { finishRetry = resolve; });
      }
      if (url.pathname === "/api/pint-drops") return json({ drops: [], passportAreas: [] });
      return previousFetch(input, init);
    }));
    await visit("alice_pints");
    const message = `We couldn't check ${lane}.`;
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain(message));
    });
    if (lane === "saved venues") expect(host.textContent).not.toContain("No saved venues yet.");
    const failure = Array.from(host.querySelectorAll(".emptyState"))
      .find((element) => element.textContent?.includes(message));
    failed = false;
    await act(async () => defined(failure?.querySelector<HTMLButtonElement>("button")).click());
    await act(async () => { await vi.waitFor(() => expect(finishRetry).toBeDefined()); });
    expect(host.textContent).toContain(message);
    await act(async () => defined(finishRetry)(json(answer)));
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain(result));
    });
    expect(host.textContent).not.toContain(message);
  });

  it("does not present empty pint statistics when the read fails, and retries", async () => {
    let failed = true;
    const previousFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/pint-drops") return failed ? json({}, 429) : json({ drops: [], passportAreas: [] });
      return previousFetch(input, init);
    }));

    await visit("alice_pints");
    await vi.waitFor(() => expect(host.textContent).toContain("Couldn't load pints right now."));
    const stats = defined(host.querySelector('[aria-label="Profile statistics"]'));
    expect(stats.textContent).not.toContain("None yet");
    expect(stats.textContent).toContain("Couldn't check");

    failed = false;
    const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Retry");
    await act(async () => defined(retry).click());
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).not.toContain("Couldn't load pints right now."));
    });
    expect(host.textContent).toContain("None yet");
  });

  it("still offers a live account's follow and message controls to a stranger", async () => {
    const text = await visit("alice_pints");

    expect(text).toContain("Sign in to follow");
    expect(text).toContain("Sign in to message");
  });

  it.each([
    { handle: "nobody-here-xyz", expected: "nobodyherexyz" },
    { handle: "suspendedbob", expected: "suspendedbob" },
    { handle: "bannedbob", expected: "bannedbob" },
  ])("shows the claim screen for $handle to a stranger", async ({ handle, expected }) => {
    const empty = await visit(handle);
    expect(host.querySelector("h1")?.textContent).toBe(`Nobody has claimed @${expected}`);
    expect(empty).not.toContain("Pints logged");
    expect(host.querySelector('a[href="/u/you"]')?.textContent).toBe("Claim a handle");
  });

  it("shows a suspended owner their profile instead of the claim screen", async () => {
    session.user = { id: "user-suspended" };
    session.handle = "suspendedbob";
    const text = await visit("suspendedbob");
    expect(text).toContain("Bob");
    expect(text).toContain("Edit profile");
    expect(text).not.toContain("Nobody has claimed");
  });

  it("restores a suspended owner's profile through the not-found fallback", async () => {
    route.pathname = "/u/suspendedbob";
    session.user = { id: "user-suspended" };
    session.handle = "suspendedbob";
    await act(async () => {
      root.render(createElement(Suspense, { fallback: null },
        createElement(ProfileNotFoundClient, { fallback: "Not found" }),
      ));
    });
    expect(host.textContent).toContain("Bob");
    expect(host.textContent).toContain("Edit profile");
    expect(host.textContent).not.toContain("Nobody has claimed");
  });

  it("shows an unknown handle through the not-found fallback", async () => {
    route.pathname = "/u/nobody-here-xyz";
    await act(async () => {
      root.render(createElement(Suspense, { fallback: null },
        createElement(ProfileNotFoundClient, { fallback: "Not found" }),
      ));
    });
    expect(host.querySelector("h1")?.textContent).toBe("Nobody has claimed @nobodyherexyz");
  });

  it.each([
    { rejects: false, cached: false },
    { rejects: true, cached: false },
    { rejects: false, cached: true },
    { rejects: true, cached: true },
  ])("shows a public profile without viewer credentials (rejects: $rejects, cached: $cached)", async ({ rejects, cached }) => {
    session.user = { id: "viewer-bob" };
    session.handle = "bob_bitter";
    if (rejects) accessToken.mockRejectedValue(new Error("Session unavailable"));
    else accessToken.mockResolvedValue(null);
    let finish: ((response: Response) => void) | undefined;
    if (cached) {
      writeSurfaceSnapshot("/api/profiles/alice_pints?viewer=bob_bitter", await profileAnswer("alice_pints", new Headers()).json());
      profileResponse = new Promise((resolve) => { finish = resolve; });
    }

    const text = await visit("alice_pints");

    expect(host.querySelector("h1")?.textContent).toBe("Alice");
    expect(text).not.toContain("This profile could not load");
    expect(text).not.toContain("Nobody has claimed");
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();

    if (finish) await act(async () => { defined(finish)(profileAnswer("alice_pints", new Headers())); });
  });

  it.each([
    { viewer: "suspendedbob", rejects: false },
    { viewer: "suspendedbob", rejects: true },
    { viewer: "alice_pints", rejects: false },
    { viewer: "alice_pints", rejects: true },
  ])("fails the read when credentials are unavailable for $viewer (rejects: $rejects)", async ({ viewer, rejects }) => {
    session.user = { id: viewer === "suspendedbob" ? "user-suspended" : "viewer-alice" };
    session.handle = viewer;
    if (rejects) accessToken.mockRejectedValue(new Error("Session unavailable"));
    else accessToken.mockResolvedValue(null);

    const text = await visit("suspendedbob");

    expect(text).toContain("This profile could not load");
    expect(text).not.toContain("Nobody has claimed");
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();
    expect(host.querySelector('a[href="/u/suspendedbob"]')?.textContent).toBe("Try again");
  });

  it.each(["", "bob_bitter"])("shows a cached profile during revalidation for viewer '%s'", async (viewer) => {
    if (viewer) {
      session.user = { id: "viewer-bob" };
      session.handle = viewer;
    }
    writeSurfaceSnapshot(
      `/api/profiles/alice_pints${viewer ? `?viewer=${viewer}` : ""}`,
      await profileAnswer("alice_pints", new Headers()).json(),
    );
    let finish!: (response: Response) => void;
    profileResponse = new Promise((resolve) => { finish = resolve; });

    const text = await visit("alice_pints");

    expect(text).toContain("Alice");
    expect(text).not.toContain("Loading profile");
    expect(text).not.toContain("Nobody has claimed");

    await act(async () => { finish(profileAnswer("alice_pints", new Headers())); });
    expect(host.textContent).toContain("Alice");
  });

  it.each(["", "suspendedbob"])("rejects cached absence after failed revalidation for viewer '%s'", async (viewer) => {
    if (viewer) {
      session.user = { id: "user-suspended" };
      session.handle = viewer;
    }
    writeSurfaceSnapshot(`/api/profiles/suspendedbob${viewer ? `?viewer=${viewer}` : ""}`, { profile: null });
    profileReadFails = true;

    expect(await visit("suspendedbob")).not.toContain("Nobody has claimed");
    await expect.poll(async () => {
      await act(async () => {});
      return host.textContent;
    }).toContain("This profile could not load");
    expect(host.textContent).not.toContain("Nobody has claimed");
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();
  });

  it("keeps a cached public card when revalidation fails", async () => {
    writeSurfaceSnapshot("/api/profiles/alice_pints", { profile: LIVE_PROFILE });
    profileResponse = Promise.resolve(json({ code: "UNAUTHENTICATED" }, 401));

    expect(await visit("alice_pints")).toContain("Alice");
    expect(host.textContent).not.toContain("Nobody has claimed");
    expect(host.textContent).not.toContain("This profile could not load");
  });

  it("does not reuse an anonymous in-flight absence for an owner read", async () => {
    session.user = { id: "user-suspended" };
    session.handle = "suspendedbob";
    let finish!: (response: Response) => void;
    let anonymousRead!: Promise<unknown>;
    await act(async () => {
      anonymousRead = loadSurfaceJson("/api/profiles/suspendedbob?viewer=suspendedbob", {
        fetchImpl: () => new Promise((resolve) => { finish = resolve; }),
      }, () => {});
    });

    const text = await visit("suspendedbob");
    await act(async () => {
      finish(json({ profile: null }));
      await anonymousRead;
    });
    expect(text).toContain("Bob");
    expect(host.textContent).toContain("Edit profile");
    expect(host.textContent).not.toContain("Nobody has claimed");
  });

  it("waits for alias confirmation when revalidation removes a cached profile", async () => {
    writeSurfaceSnapshot("/api/profiles/alice_pints", await profileAnswer("alice_pints", new Headers()).json());
    let finishProfile!: (response: Response) => void;
    let finishAlias!: (response: Response) => void;
    profileResponse = new Promise((resolve) => { finishProfile = resolve; });
    aliasResponse = new Promise((resolve) => { finishAlias = resolve; });
    expect(await visit("alice_pints")).toContain("Alice");

    await act(async () => { finishProfile(json({ profile: null })); });
    expect(host.textContent).toContain("Loading profile");
    expect(host.textContent).not.toContain("Nobody has claimed");

    await act(async () => { finishAlias(json({ code: "NOT_FOUND" }, 404)); });
    expect(host.textContent).toContain("Nobody has claimed @alice_pints");
  });

  it("waits for the owner read when a suspended owner's identity resolves", async () => {
    session.user = { id: "user-suspended" };
    session.identityResolved = false;
    expect(await visit("suspendedbob")).toContain("Loading profile");

    let finish!: (response: Response) => void;
    profileResponse = new Promise((resolve) => { finish = resolve; });
    session.handle = "suspendedbob";
    session.identityResolved = true;
    const pending = await visit("suspendedbob");
    expect(pending).toContain("Loading profile");
    expect(pending).not.toContain("Nobody has claimed");
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();

    await act(async () => {
      finish(profileAnswer("suspendedbob", new Headers({ authorization: "Bearer token" })));
    });
    expect(host.textContent).toContain("Bob");
    expect(host.textContent).toContain("Edit profile");
    expect(host.textContent).not.toContain("Nobody has claimed");
  });

  it("returns to the claim screen when a suspended owner signs out", async () => {
    session.user = { id: "user-suspended" };
    session.handle = "suspendedbob";
    expect(await visit("suspendedbob")).toContain("Bob");

    session.user = null;
    session.handle = "";
    session.revision += 1;
    const text = await visit("suspendedbob");
    expect(text).toContain("Nobody has claimed @suspendedbob");
    expect(text).not.toContain("Edit profile");
  });

  it.each(["account", "handle", "viewer"])(
    "withholds the previous private card across a %s boundary",
    async (boundary) => {
      session.user = { id: "viewer-bob" };
      session.handle = "bob_bitter";
      profileResponse = Promise.resolve(json({
        profile: { ...LIVE_PROFILE, visibility: "private", bio: "For mates only" },
        projection: "full",
      }));
      expect(await visit("alice_pints")).toContain("For mates only");

      let finish!: (response: Response) => void;
      profileResponse = new Promise((resolve) => { finish = resolve; });
      if (boundary === "account") {
        session.user = { id: "viewer-charlie" };
        session.revision += 1;
        clearSurfaceCache();
      }
      if (boundary === "viewer") session.handle = "charlie_cider";
      const handle = boundary === "handle" ? "charlie_cider" : "alice_pints";

      const pending = await visit(handle);
      expect(pending).toContain("Loading profile");
      expect(pending).not.toContain("For mates only");
      expect(pending).not.toContain("Alice");
      expect(pending).not.toContain("Nobody has claimed");
      expect(host.querySelector('[data-primary-action]')).toBeNull();

      await act(async () => {
        finish(json({
          profile: { ...LIVE_PROFILE, handle, visibility: "private" },
          projection: "limited",
        }));
      });
      expect(host.querySelector("h1")?.textContent).toBe("Alice");
      expect(host.textContent).not.toContain("For mates only");
      expect(host.textContent).not.toContain("Nobody has claimed");
    },
  );

  it("does not offer a claim when the profile read fails", async () => {
    profileReadFails = true;
    const text = await visit("nobody-here-xyz");
    expect(text).not.toContain("Nobody has claimed");
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();
    await expect.poll(async () => {
      await act(async () => {});
      return host.textContent;
    }).toContain("This profile could not load");
    expect(host.textContent).not.toContain("Nobody has claimed");
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();
    expect(host.querySelector('a[href="/u/nobodyherexyz"]')?.textContent).toBe("Try again");
  });

  it.each(["unavailable", "network", "malformed", "pending"])(
    "shows a live profile when alias resolution is %s",
    async (failure) => {
      aliasResponse = failure === "unavailable"
        ? Promise.resolve(json({ code: "STORE_UNAVAILABLE" }, 503))
        : failure === "malformed"
          ? Promise.resolve(new Response("{"))
          : failure === "pending"
            ? new Promise<Response>(() => undefined)
            : null;
      aliasNetworkFails = failure === "network";

      const text = await visit("alice_pints");
      expect(text).toContain("Alice");
      expect(text).toContain("Sign in to follow");
      expect(text).toContain("Sign in to message");
      expect(text).not.toContain("This profile could not load");
      expect(text).not.toContain("Nobody has claimed");
    },
  );

  it("waits for alias resolution before declaring a handle unclaimed", async () => {
    let finish!: (response: Response) => void;
    aliasResponse = new Promise((resolve) => { finish = resolve; });
    const text = await visit("old_alice");
    expect(text).toContain("Loading profile");
    expect(text).not.toContain("Nobody has claimed");

    await act(async () => {
      finish(json({ status: "live", currentHandle: "alice_pints", redirect: true }));
    });

    expect(router.replace).toHaveBeenCalledWith("/u/alice_pints");
    expect(host.textContent).not.toContain("Nobody has claimed");
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();
  });

  it("offers a claim only after the alias read confirms absence", async () => {
    let finish!: (response: Response) => void;
    aliasResponse = new Promise((resolve) => { finish = resolve; });
    expect(await visit("nobody-here-xyz")).not.toContain("Nobody has claimed");

    await act(async () => { finish(json({ code: "NOT_FOUND" }, 404)); });

    expect(host.textContent).toContain("Nobody has claimed @nobodyherexyz");
  });

  it.each(["unavailable", "network", "malformed"])(
    "does not offer a claim when alias resolution is %s",
    async (failure) => {
      aliasResponse = failure === "unavailable"
        ? Promise.resolve(json({ code: "STORE_UNAVAILABLE" }, 503))
        : failure === "malformed"
          ? Promise.resolve(new Response("{"))
          : null;
      aliasNetworkFails = failure === "network";
      const text = await visit("old_alice");

      expect(text).toContain("This profile could not load");
      expect(text).not.toContain("Nobody has claimed");
      expect(host.querySelector('a[href="/u/you"]')).toBeNull();
    },
  );

  it("does not offer a claimed canonical handle when its profile row is missing", async () => {
    aliasResponse = Promise.resolve(json({ status: "live", currentHandle: "claimedbob", redirect: false }));
    expect(await visit("claimedbob")).toContain("This profile could not load");
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();
  });

  it("keeps a departed alias reserved", async () => {
    aliasResponse = Promise.resolve(json({ status: "gone" }));
    expect(await visit("departedbob")).toContain("This account has left");
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();
  });

  it.each(["alice_pints", "nobody-here-xyz", "you"])(
    "shows identity retry on %s and recovers after resolution",
    async (handle) => {
      session.user = { id: "viewer-1" };
      session.identityResolved = false;
      session.identityUnavailable = true;
      session.retryIdentity.mockImplementation(() => {
        session.identityResolved = true;
        session.identityUnavailable = false;
      });

      const text = await visit(handle);
      expect(text).toContain("Your profile could not load");
      expect(text).not.toContain("Nobody has claimed");
      const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Retry");
      expect(retry).toBeDefined();
      await act(async () => { defined(retry).click(); });
      await visit(handle);

      expect(session.retryIdentity).toHaveBeenCalledOnce();
      expect(host.textContent).not.toContain("Your profile could not load");
      if (handle === "alice_pints") expect(host.textContent).toContain("Alice");
      if (handle === "nobody-here-xyz") expect(host.textContent).toContain("Nobody has claimed @nobodyherexyz");
    },
  );

  it("calls notFound for a policy-blocked handle", async () => {
    await expect(visit("karansdad")).rejects.toThrow("notFound");
  });

  it("gives a signed-in reader notFound on a policy-blocked handle", async () => {
    session.user = { id: "viewer-1" };
    session.handle = "bob_bitter";

    await expect(visit("karansdad")).rejects.toThrow("notFound");
  });
});
