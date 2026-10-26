// @vitest-environment jsdom

// /u/you paints the Wanted panel's identity-neutral head while the session is
// still answering, a signed-out reader meets the claim invitation and no panel,
// and only an owner's own profile renders the Wanted body. The route,
// WantedList and next/dynamic are real. WantedListBody is a lazy mock factory:
// vitest runs it only when the module is imported, and nothing on this page
// imports it except WantedList's dynamic loader, so `evaluations` moves only
// once the mounted route renders that loader.

import { act, createElement, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SessionState = {
  user: { id: string } | null;
  handle: string | null;
  phase: "unresolved" | "signed-out" | "signed-in";
};

const wantedBody = vi.hoisted(() => ({ evaluations: 0, mounts: 0 }));

// One answer behind useAuth, useViewerSession and useViewerHandle, so a
// transition re-renders the mounted route the way the provider would.
const session = vi.hoisted(() => {
  const unresolved: SessionState = { user: null, handle: null, phase: "unresolved" };
  const listeners = new Set<() => void>();
  let current = unresolved;
  return {
    get: (): SessionState => current,
    set: (next: SessionState) => {
      current = next;
      for (const listener of listeners) listener();
    },
    reset: () => {
      current = unresolved;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

const navigation = vi.hoisted(() => ({
  replace: vi.fn((href: string) => {
    window.history.replaceState(null, "", href);
  }),
  push: vi.fn(),
  prefetch: vi.fn(async () => undefined),
}));

vi.mock("@/components/wanted/WantedListBody", async () => {
  wantedBody.evaluations += 1;
  const { createElement: h, useEffect } = await import("react");
  return {
    default: function WantedListBodyDouble() {
      useEffect(() => {
        wantedBody.mounts += 1;
      }, []);
      return h("div", { "data-testid": "wanted-body" }, "Wanted body loaded");
    },
  };
});

vi.mock("@/components/auth/AuthProvider", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAuth: () => {
      const state = useSyncExternalStore(session.subscribe, session.get, session.get);
      const identityResolved = state.phase !== "unresolved";
      return {
        accountRevision: 0,
        user: state.user,
        handle: state.handle,
        configured: true,
        identityResolved,
        loading: !identityResolved,
        signOut: async () => undefined,
      };
    },
  };
});
vi.mock("@/components/auth/useViewerSession", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useViewerSession: () => {
      const { phase } = useSyncExternalStore(session.subscribe, session.get, session.get);
      return {
        phase,
        signedIn: phase === "signed-in",
        signedOut: phase === "signed-out",
        unresolved: phase === "unresolved",
      };
    },
  };
});
vi.mock("@/components/auth/useViewerHandle", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useViewerHandle: () => {
      const state = useSyncExternalStore(session.subscribe, session.get, session.get);
      return state.phase === "unresolved" ? null : state.handle;
    },
  };
});
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "owner-token" }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => false }));

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(window.location.search),
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

// Panels with their own reads that are not the Wanted boundary.
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNavMore", () => ({ default: () => null }));
vi.mock("@/components/profile/PubmaxxAccountHub", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => null }));
vi.mock("@/components/diary/DiaryList", () => ({ default: () => null }));
vi.mock("@/components/profile/ProfileTimeline", () => ({ default: () => null }));
vi.mock("@/components/profile/SavedPubList", () => ({ default: () => null }));
vi.mock("@/components/profile/YourContributionsCard", () => ({ default: () => null }));
vi.mock("@/components/profile/ClaimMomentWelcome", () => ({ default: () => null }));
vi.mock("@/components/profile/FirstActionsRow", () => ({ default: () => null }));
vi.mock("@/components/profile/ContributionLanesCard", () => ({ default: () => null }));
vi.mock("@/components/profile/OutTonightToggle", () => ({ default: () => null }));
vi.mock("@/components/profile/OutTonightBoard", () => ({ default: () => null }));
vi.mock("@/components/profile/OutTonightCrewLine", () => ({ default: () => null }));
vi.mock("@/components/profile/NextBadgeChips", () => ({ default: () => null }));

import ProfilePageClient, { YOU_SIGN_IN_HREF } from "@/app/u/[handle]/ProfilePageClient";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const WANTED_LEDE =
  "Paste a pub name or a link you saved elsewhere. It becomes a place you can plan around.";
const OWNER = "alice_pints";
const OWNER_PROFILE = {
  id: "22222222-2222-4222-8222-222222222222",
  handle: OWNER,
  displayName: "Alice",
  visibility: "public",
  createdAt: "2026-06-01T12:00:00.000Z",
  updatedAt: "2026-08-10T09:00:00.000Z",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function answer(input: RequestInfo | URL): Response {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, "http://localhost");
  if (url.pathname.startsWith("/api/profiles/")) {
    const handle = decodeURIComponent(url.pathname.slice("/api/profiles/".length));
    return json({
      profile: handle === OWNER ? OWNER_PROFILE : null,
      projection: "full",
      socialLinks: [],
      counts: { followers: 0, following: 0 },
      viewerFollowing: false,
      followsViewer: false,
    });
  }
  if (url.pathname === "/api/identity/handle/resolve") {
    return json({ status: "active", currentHandle: url.searchParams.get("handle"), redirect: false });
  }
  if (url.pathname === "/api/pint-drops") return json({ drops: [], passportAreas: [] });
  if (url.pathname === "/api/crawls") return json({ count: 0, crawls: [], hasMore: false });
  // Anything else answers like a missing route, which this page reads fail-soft.
  return json({ error: { code: "NOT_FOUND", message: "Not stubbed." } }, 404);
}

function settledParams<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

type ActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actGlobal = globalThis as ActGlobal;
let previousActEnvironment: boolean | undefined;
let startingHref: string;
let host: HTMLElement;
let root: Root;

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

// A changed dynamic segment remounts the page in the App Router, so the
// handle keys the element.
async function show(handle: string): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        Suspense,
        { fallback: null },
        createElement(ProfilePageClient, { key: handle, params: settledParams({ handle }) }),
      ),
    );
  });
  await settle();
}

async function sessionAnswers(next: SessionState): Promise<void> {
  await act(async () => {
    session.set(next);
  });
  await settle();
}

const wantedPanel = () => host.querySelector<HTMLElement>("section#wanted");
const wantedBodyMarker = () => host.querySelector('[data-testid="wanted-body"]');

beforeEach(() => {
  previousActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  startingHref = window.location.href;
  window.history.replaceState(null, "", "/u/you");
  window.localStorage.clear();
  session.reset();
  clearSurfaceCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => answer(input)),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  session.reset();
  clearSurfaceCache();
  window.localStorage.clear();
  window.history.replaceState(null, "", startingHref);
  if (previousActEnvironment === undefined) {
    delete actGlobal.IS_REACT_ACT_ENVIRONMENT;
  } else {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

describe("the Wanted body on /u/you", () => {
  it("is not imported until the owner's own profile renders it", async () => {
    // Identity still answering: the neutral head paints, nothing else does.
    await show("you");
    expect(host.querySelector(".profileIdentityLoadingSurface")).not.toBeNull();
    expect(wantedPanel()?.querySelector(".wantedPanel__lede")?.textContent).toContain(WANTED_LEDE);
    expect(wantedBodyMarker()).toBeNull();
    expect(wantedBody).toEqual({ evaluations: 0, mounts: 0 });
    expect(host.querySelector("#you-title")).toBeNull();
    expect(host.textContent).not.toContain("With a handle you can:");

    // Signed out: the invitation, and no Wanted panel at all. The account hub
    // may load after the document completes, so it is not asserted either way.
    await sessionAnswers({ user: null, handle: null, phase: "signed-out" });
    expect(host.querySelector("#you-title")?.textContent).toBe("Claim your @handle.");
    expect(
      host.querySelector(".youIdentityActions a[data-primary-action]")?.getAttribute("href"),
    ).toBe(YOU_SIGN_IN_HREF);
    expect(host.querySelector(".wantedPanel")).toBeNull();
    expect(wantedBodyMarker()).toBeNull();
    expect(wantedBody).toEqual({ evaluations: 0, mounts: 0 });
    expect(navigation.replace).not.toHaveBeenCalled();

    // Signed in, still on the sentinel: the handoff stays neutral and sends
    // the reader to their own handle.
    await sessionAnswers({ user: { id: "owner-1" }, handle: OWNER, phase: "signed-in" });
    expect(host.querySelector("#you-title")).toBeNull();
    expect(wantedPanel()?.querySelector(".wantedPanel__lede")?.textContent).toContain(WANTED_LEDE);
    expect(wantedBodyMarker()).toBeNull();
    expect(wantedBody).toEqual({ evaluations: 0, mounts: 0 });
    expect(navigation.replace).toHaveBeenCalledWith(`/u/${OWNER}`);

    // The owner's own profile is the one route that asks for the body.
    const destination = new URL(
      String(navigation.replace.mock.calls.at(-1)?.[0]),
      "http://localhost",
    ).pathname;
    await show(decodeURIComponent(destination.slice("/u/".length)));
    expect(host.querySelector(".profileErrorState")).toBeNull();
    expect(host.querySelector(".profileIdentityLoadingSurface")).toBeNull();
    const panel = wantedPanel();
    expect(panel?.querySelector(".wantedPanel__lede")?.textContent).toContain(WANTED_LEDE);
    expect(panel?.querySelector('[data-testid="wanted-body"]')?.textContent).toBe(
      "Wanted body loaded",
    );
    expect(wantedBody).toEqual({ evaluations: 1, mounts: 1 });
  });
});
