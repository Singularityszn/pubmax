// @vitest-environment jsdom
import { act, createElement, Suspense, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/components/auth/authContext";

const h = vi.hoisted(() => ({
  navigate: vi.fn(), getSession: vi.fn(),
  session: null as Session | null,
  subscriber: null as null | ((event: string, session: Session | null) => void),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.navigate, replace: h.navigate, prefetch: vi.fn() }), usePathname: () => "/u/you", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", async (original) => ({
  ...await original<typeof import("@/lib/analytics")>(),
  trackEvent: vi.fn(), analyticsCollectionAllowed: () => false,
}));
vi.mock("@/lib/nativePlatform", () => ({ nativePlatform: () => null, isNativeApp: () => false }));
vi.mock("@/lib/authClient", async (original) => ({
  ...await original<typeof import("@/lib/authClient")>(),
  isAuthConfigured: () => true,
  // A signed-in browser stores its session, so the client loads at once.
  hasStoredBrowserSession: () => h.session !== null,
  getAccessToken: async () => h.session?.access_token ?? null,
  ensureSupabaseBrowser: async () => ({ auth: {
    getSession: h.getSession,
    onAuthStateChange: (callback: typeof h.subscriber) => {
      h.subscriber = callback;
      queueMicrotask(() => callback?.("INITIAL_SESSION", h.session));
      return { data: { subscription: { unsubscribe: () => { h.subscriber = null; } } } };
    },
  } }),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: async () => h.session ? ({ status: "local", session: h.session }) : ({ status: "none" }),
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: true, apple: true, microsoft: true }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
  guardSocialAuthProvider: async (_provider: string, start: () => Promise<unknown>) => ({ result: await start() }),
}));
vi.mock("@/lib/authSessionResumeClient", () => ({
  clearPersistedSession: async () => {}, persistSessionForResume: async () => "stored", markResumePersisted: () => {},
  resumeAlreadyPersisted: () => true, requestResumeLink: vi.fn(),
}));

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNavMore", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => null }));
vi.mock("@/components/social/StarterPacks", () => ({ default: () => null }));
vi.mock("@/components/social/FindYourLot", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/components/social/PubRankingPanel", () => ({ default: () => null }));
vi.mock("@/components/social/CreatorListsLane", () => ({ default: () => null }));
vi.mock("@/components/founding/FoundersWallLink", () => ({ default: () => null }));
vi.mock("@/app/social/SocialComposer", () => ({ default: () => null }));
vi.mock("@/app/social/SocialTagInbox", () => ({ default: () => null }));
vi.mock("@/app/social/SocialOutbox", () => ({ default: () => null }));
vi.mock("@/components/profile/PubmaxxAccountHub", () => ({ default: () => null }));
vi.mock("@/components/profile/ProfileTimeline", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedList", () => ({ default: () => null }));

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import SocialPageClient from "@/app/social/SocialPageClient";
import ProfilePageClient from "@/app/u/[handle]/ProfilePageClient";
import { forgetCurrentIdentityRead } from "@/lib/currentIdentityRead";
import { setProviderAuthState, setProviderIdentity } from "@/lib/authProviderRevision";

const account = (id: string) => ({ user: { id }, access_token: `token-${id}`, refresh_token: `refresh-${id}` }) as Session;
let actions: AuthContextValue;
function Probe() {
  const auth = useAuth();
  useEffect(() => { actions = auth; }, [auth]);
  return null;
}
let root: Root;
let host: HTMLDivElement;
let identityResponse: () => Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear(); forgetCurrentIdentityRead();
  setProviderIdentity("supabase", null); setProviderAuthState("supabase", "unresolved");
  h.session = account("alice");
  h.getSession.mockImplementation(async () => ({ data: { session: h.session }, error: null }));
  window.history.replaceState(null, "", "/map");
  identityResponse = async () => json({ error: "unavailable" }, 503);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/identity/handle/current")) return identityResponse();
    if (url.includes("/api/social/access")) return json({ state: "verified", draftScope: "a".repeat(43), viewerHandle: h.session?.user.id });
    return json({ posts: [], items: [], drops: [], nextCursor: null });
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); forgetCurrentIdentityRead(); vi.unstubAllGlobals(); vi.useRealTimers();
});
async function mount(surface: "social" | "you") {
  const content = surface === "social"
    ? createElement(SocialPageClient, { initialState: { valid: true, tab: "posts", feed: "following", area: null }, rivalry: [], heritageCrawls: [] })
    : createElement(ProfilePageClient, { params: Promise.resolve({ handle: "you" }) });
  await act(async () => root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false },
    createElement(Probe), createElement(Suspense, { fallback: "Loading" }, content))));
}
function retry() {
  const button = [...host.querySelectorAll("button")].find((item) => /retry/i.test(item.textContent ?? ""));
  expect(button, host.textContent ?? "").toBeDefined();
  button!.click();
}
function expectVerifiedSocialFeed() {
  expect(host.querySelector(".sampleSkeleton.socialFeed")).toBeNull();
  const feed = host.querySelector('section[aria-label="Social posts"]');
  expect(feed).not.toBeNull();
  expect(feed?.closest("[data-sample-skeleton]")).toBeNull();
}

describe("account identity recovery", () => {
  it("lets a signed-in Social viewer retry a failed identity read without a reload", async () => {
    await mount("social");
    expect(host.querySelector(".sampleSkeleton.socialFeed")).toBeNull();
    expect(host.querySelector('section[aria-label="Social posts"]')).toBeNull();
    expect(actions.identityResolved).toBe(false);
    identityResponse = async () => json({ handle: "alice" });
    await act(async () => retry());
    expect(actions.identityResolved).toBe(true);
    expect(actions.handle).toBe("alice");
    expectVerifiedSocialFeed();
  });

  it("lets the You page recover without treating an unavailable account as a missing handle", async () => {
    await mount("you");
    expect(host.textContent).toContain("Your profile could not load");
    expect(host.textContent).not.toContain("Claim");
    identityResponse = async () => json({ handle: "alice" });
    await act(async () => retry());
    expect(actions.identityResolved).toBe(true);
    expect(h.navigate).toHaveBeenCalledWith("/u/alice");
  });

  it("retries a stalled identity read and ignores its late answer", async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    identityResponse = () => new Promise((resolve) => { release = resolve; });
    await mount("social");
    expect(host.querySelector(".sampleSkeleton.socialFeed")).not.toBeNull();
    expect(host.querySelector('section[aria-label="Social posts"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(host.querySelector(".sampleSkeleton.socialFeed")).toBeNull();
    expect(host.querySelector('section[aria-label="Social posts"]')).toBeNull();
    expect(actions.identityResolved).toBe(false);
    identityResponse = async () => json({ handle: "alice" });
    await act(async () => retry());
    expect(actions.handle).toBe("alice");
    expectVerifiedSocialFeed();
    await act(async () => release(json({ handle: "obsolete" })));
    expect(actions.handle).toBe("alice");
    expect(localStorage.getItem("pubmax_handle")).toBe("alice");
    expectVerifiedSocialFeed();
  });

  it("does not publish another account's late identity after an account switch", async () => {
    let release!: (response: Response) => void;
    identityResponse = () => new Promise((resolve) => { release = resolve; });
    await mount("social");
    expect(host.querySelector(".sampleSkeleton.socialFeed")).not.toBeNull();
    expect(host.querySelector('section[aria-label="Social posts"]')).toBeNull();
    identityResponse = async () => json({ handle: "bob" });
    await act(async () => {
      h.session = account("bob");
      h.subscriber?.("SIGNED_IN", h.session);
    });
    expect(actions.handle).toBe("bob");
    expectVerifiedSocialFeed();
    await act(async () => release(json({ handle: "alice" })));
    expect(actions.user?.id).toBe("bob");
    expect(actions.handle).toBe("bob");
    expect(localStorage.getItem("pubmax_handle")).toBe("bob");
    expectVerifiedSocialFeed();
  });

  it.each(["malformed", "rejected"])("offers recovery for a %s identity response", async (failure) => {
    identityResponse = failure === "malformed"
      ? async () => json({})
      : async () => { throw new TypeError("Network unavailable"); };
    await mount("you");
    expect(actions.identityResolved).toBe(false);
    expect(host.textContent).toContain("Your profile could not load");
    identityResponse = async () => json({ handle: "alice" });
    await act(async () => retry());
    expect(actions.handle).toBe("alice");
  });

  it("keeps a confirmed missing handle distinct from an unavailable identity", async () => {
    identityResponse = async () => json({ handle: null });
    await mount("you");
    expect(actions.identityResolved).toBe(true);
    expect(actions.handle).toBeNull();
    expect(host.textContent).not.toContain("Your profile could not load");
    expect(host.querySelector('[aria-label="Loading your profile"]')).toBeNull();
  });
});
