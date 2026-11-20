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
  useSearchParams: () => new URLSearchParams(window.location.search),
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

const session = vi.hoisted(() => ({ user: null as { id: string } | null, handle: "", revision: 0 }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    accountRevision: session.revision,
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
  getAccessToken: async () => "token",
}));

import ProfilePageClient from "@/app/u/[handle]/ProfilePageClient";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
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
  session.handle = "";
  session.revision = 0;
  profileReadFails = false;
  clearSurfaceCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const profileMatch = /^\/api\/profiles\/([^/]+)$/.exec(url.pathname);
      if (profileMatch) {
        if (profileReadFails) return json({ error: "Unavailable" }, 503);
        return profileAnswer(decodeURIComponent(defined(profileMatch[1])), new Headers(init?.headers));
      }
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

  it("does not offer a claim when the profile read fails", async () => {
    profileReadFails = true;
    const text = await visit("nobody-here-xyz");
    expect(text).not.toContain("Nobody has claimed");
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();
  });

  it("calls notFound for a policy-blocked handle", async () => {
    await expect(visit("karansdad")).rejects.toThrow("notFound");
  });

  it("gives a signed-in reader notFound on a policy-blocked handle", async () => {
    session.user = { id: "viewer-1" };
    session.handle = "bob_bitter";

    await expect(visit("karansdad")).rejects.toThrow("notFound");
  });
});
