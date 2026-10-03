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

const session = vi.hoisted(() => ({ user: null as { id: string } | null, handle: "", accountRevision: 0 }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    accountRevision: session.accountRevision,
    user: session.user,
    handle: session.handle || null,
    configured: true,
    identityResolved: true,
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
vi.mock("@/lib/authClient", () => ({
  getAccessToken: async () => session.user ? `fixture-${session.user.id}` : null,
}));

import ProfilePageClient from "@/app/u/[handle]/ProfilePageClient";
import { clearSurfaceCache, readSurfaceSnapshot, SURFACE_CACHE_NAMESPACE } from "@/lib/surfaceDataCache";

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

function profileAnswer(handle: string): Response {
  return json({
    profile: handle === "alice_pints" ? LIVE_PROFILE : null,
    projection: "full",
    socialLinks: [],
    counts: { followers: 0, following: 0 },
    viewerFollowing: false,
    followsViewer: false,
  });
}

let host: HTMLElement;
let root: Root;

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
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (threw) throw threw;
  return host.textContent ?? "";
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.user = null;
  session.handle = "";
  session.accountRevision = 0;
  clearSurfaceCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const profileMatch = /^\/api\/profiles\/([^/]+)$/.exec(url.pathname);
      if (profileMatch) return profileAnswer(decodeURIComponent(profileMatch[1]));
      if (url.pathname === "/api/identity/handle/resolve") {
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
  it("still offers a live account's follow and message controls to a stranger", async () => {
    const text = await visit("alice_pints");

    expect(text).toContain("Sign in to follow");
    expect(text).toContain("Sign in to message");
  });

  it("shows a stranger no follow or message shell on a free handle only", async () => {
    const empty = await visit("never_existed_qa9");
    expect(empty).toContain("Claim this handle");
  });

  it("calls notFound for a policy-blocked handle", async () => {
    await expect(visit("karansdad")).rejects.toThrow("notFound");
  });

  it("gives a signed-in reader notFound on a policy-blocked handle", async () => {
    session.user = { id: "viewer-1" };
    session.handle = "bob_bitter";

    await expect(visit("karansdad")).rejects.toThrow("notFound");
  });

  it("aborts an old private card body when another canonical viewer takes over the mounted page", async () => {
    // Fixture projections model an entitled A and a stranger B. They do not
    // verify provider sessions or the server's private-profile entitlement.
    const privateCanary = "private-card-only-for-viewer-a";
    const oldKey = "/api/profiles/alice_pints?viewer=bob_bitter";
    const currentKey = "/api/profiles/alice_pints?viewer=charlie_lager";
    const currentBody = {
      profile: { ...LIVE_PROFILE, visibility: "private" },
      projection: "limited",
      socialLinks: [],
      counts: { followers: 0, following: 0 },
      viewerFollowing: false,
      followsViewer: false,
    };
    const oldBody = {
      ...currentBody,
      profile: { ...currentBody.profile, bio: privateCanary },
      projection: "full",
    };
    const fallback = vi.mocked(fetch).getMockImplementation();
    if (!fallback) throw new Error("Profile fetch fixture is missing.");
    const cardReads: Array<{ key: string; authorization: string | null }> = [];
    let oldSignal: AbortSignal | undefined;
    let bodyStarted = false;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let bodyReleased = false;
    const releaseOldBody = () => {
      if (bodyReleased || !bodyController) return;
      bodyReleased = true;
      if (oldSignal?.aborted) return;
      bodyController.enqueue(new TextEncoder().encode(JSON.stringify(oldBody)));
      bodyController.close();
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      const key = `${url.pathname}${url.search}`;
      if (key !== oldKey && key !== currentKey) return fallback(input, init);
      cardReads.push({ key, authorization: new Headers(init?.headers).get("authorization") });
      if (key === currentKey) return json(currentBody);
      oldSignal = init?.signal ?? undefined;
      if (!oldSignal) throw new Error("Private card fetch must have an abort signal.");
      const signal = oldSignal;
      // Native Response.json consumes this stream. Demand starts the barrier;
      // abort errors the body, matching native fetch cancellation while unread.
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
        pull() { bodyStarted = true; },
      }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } });
    });
    const params = Promise.resolve({ handle: "alice_pints" });
    const renderProfile = () => root.render(createElement(
      Suspense,
      { fallback: null },
      createElement(ProfilePageClient, { params }),
    ));
    try {
      session.user = { id: "viewer-a" };
      session.handle = "bob_bitter";
      session.accountRevision = 1;
      await act(async () => renderProfile());
      await vi.waitFor(() => expect(bodyStarted).toBe(true));
      expect(oldSignal?.aborted).toBe(false);
      expect(readSurfaceSnapshot(oldKey)).toBeUndefined();

      // Real component rerender runs effect cleanup. Clearing invokes the
      // exported cache boundary; auth and canonical handles remain fixtures.
      await act(async () => {
        clearSurfaceCache();
        session.user = { id: "viewer-b" };
        session.handle = "charlie_lager";
        session.accountRevision = 2;
        renderProfile();
      });
      expect(oldSignal?.aborted).toBe(true);
      releaseOldBody();
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(readSurfaceSnapshot(currentKey)).toEqual(currentBody);
      });

      expect(cardReads).toEqual([
        { key: oldKey, authorization: "Bearer fixture-viewer-a" },
        { key: currentKey, authorization: "Bearer fixture-viewer-b" },
      ]);
      expect(host.textContent).toContain("This account is private.");
      expect(host.textContent).not.toContain(privateCanary);
      expect(readSurfaceSnapshot(oldKey)).toBeUndefined();
      expect(sessionStorage.getItem(`${SURFACE_CACHE_NAMESPACE}${oldKey}`)).toBeNull();
      expect(JSON.parse(sessionStorage.getItem(`${SURFACE_CACHE_NAMESPACE}${currentKey}`) ?? "null"))
        .toMatchObject({ value: currentBody });
    } finally {
      releaseOldBody();
    }
  });

  it("withholds an already-painted private social link while another viewer's card is pending", async () => {
    // Supported full/limited API shapes, not a real entitlement check.
    // Counts remain public on both lanes; linked socials do not.
    const privateBio = "loaded-private-bio-for-viewer-a";
    const privateLink = "https://www.instagram.com/private_social_a/";
    const oldKey = "/api/profiles/alice_pints?viewer=bob_bitter";
    const currentKey = "/api/profiles/alice_pints?viewer=charlie_lager";
    const limitedBody = {
      profile: { ...LIVE_PROFILE, visibility: "private" },
      projection: "limited",
      socialLinks: [],
      counts: { followers: 17, following: 19 },
      viewerFollowing: false,
      followsViewer: false,
    };
    const fullBody = {
      ...limitedBody,
      profile: { ...limitedBody.profile, bio: privateBio },
      projection: "full",
      socialLinks: [{
        provider: "instagram", label: "Instagram", mark: "IG",
        username: "private_social_a", profileUrl: privateLink,
      }],
    };
    const fallback = vi.mocked(fetch).getMockImplementation();
    if (!fallback) throw new Error("Profile fetch fixture is missing.");
    const cardReads: string[] = [];
    let currentSignal: AbortSignal | undefined;
    let bodyStarted = false;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let bodyReleased = false;
    const releaseCurrentBody = () => {
      if (bodyReleased || !bodyController) return;
      bodyReleased = true;
      if (currentSignal?.aborted) return;
      bodyController.enqueue(new TextEncoder().encode(JSON.stringify(limitedBody)));
      bodyController.close();
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      const key = `${url.pathname}${url.search}`;
      if (key !== oldKey && key !== currentKey) return fallback(input, init);
      cardReads.push(key);
      if (key === oldKey) return json(fullBody);
      currentSignal = init?.signal ?? undefined;
      if (!currentSignal) throw new Error("Private card fetch must have an abort signal.");
      const signal = currentSignal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
        pull() { bodyStarted = true; },
      }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } });
    });
    const params = Promise.resolve({ handle: "alice_pints" });
    const renderProfile = () => root.render(createElement(
      Suspense, { fallback: null }, createElement(ProfilePageClient, { params }),
    ));
    try {
      session.user = { id: "viewer-a" };
      session.handle = "bob_bitter";
      session.accountRevision = 1;
      await act(async () => renderProfile());
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(host.querySelector(`a[href="${privateLink}"]`)).not.toBeNull();
        expect(readSurfaceSnapshot(oldKey)).toEqual(fullBody);
      });
      expect(host.textContent).toContain(privateBio);

      await act(async () => {
        clearSurfaceCache();
        session.user = { id: "viewer-b" };
        session.handle = "charlie_lager";
        session.accountRevision = 2;
        renderProfile();
      });
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(bodyStarted).toBe(true);
        expect(host.textContent).not.toContain(privateBio);
      });
      expect(readSurfaceSnapshot(currentKey)).toBeUndefined();
      // Assert during B's held response, after the existing card reset. A late
      // limited response must not be required to remove A's private links.
      expect(host.querySelector(`a[href="${privateLink}"]`)).toBeNull();
      expect(host.textContent).not.toContain("private_social_a");

      releaseCurrentBody();
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(readSurfaceSnapshot(currentKey)).toEqual(limitedBody);
      });
      expect(cardReads).toEqual([oldKey, currentKey]);
      expect(host.textContent).toContain("This account is private.");
      expect(host.querySelector(`a[href="${privateLink}"]`)).toBeNull();
      expect(host.querySelector('a[href="/u/alice_pints/people/followers"] .profileStatValue')?.textContent).toBe("17");
      expect(host.querySelector('a[href="/u/alice_pints/people/following"] .profileStatValue')?.textContent).toBe("19");
    } finally {
      await act(async () => releaseCurrentBody());
    }
  });
});
