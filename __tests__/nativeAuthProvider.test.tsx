// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/components/auth/authContext";

const h = vi.hoisted(() => ({
  platform: "ios" as "ios" | "android" | null,
  navigate: vi.fn(), available: true, switchAccount: vi.fn(),
  canonicalOAuth: vi.fn(), getSession: vi.fn(), nativeOAuth: vi.fn(), exchange: vi.fn(), verify: vi.fn(),
  authenticate: vi.fn(), setSession: vi.fn(), signOut: vi.fn(), cancel: vi.fn(), openBrowser: vi.fn(),
  clearPersistedSession: vi.fn(async () => {}),
  session: null as Session | null,
  bootstrapOffline: false,
  clientOffline: false,
  subscriber: null as null | ((event: string, session: Session | null) => void),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.navigate }) }));
vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/nativePlatform", () => ({ nativePlatform: () => h.platform, isNativeApp: () => h.platform !== null }));
vi.mock("@/lib/nativeOAuth", () => ({ oauthOpensInSystemBrowser: () => h.platform !== null, openOAuthInSystemBrowser: h.openBrowser }));
vi.mock("@/lib/nativeAuthSession", async (original) => ({
  ...await original<typeof import("@/lib/nativeAuthSession")>(),
  nativeAuthSessionAvailable: async () => h.available,
  authenticateNativeSession: h.authenticate,
  cancelNativeAuthSession: h.cancel,
}));
vi.mock("@/lib/authClient", async (original) => ({
  ...await original<typeof import("@/lib/authClient")>(),
  createNativeAuthClient: async () => ({ auth: { signInWithOAuth: h.nativeOAuth, exchangeCodeForSession: h.exchange, getUser: h.verify, stopAutoRefresh: async () => {} } }),
  isAuthConfigured: () => true,
  ensureSupabaseBrowser: vi.fn(async () => {
    if (h.clientOffline) throw new Error("offline");
    return { auth: {
      signInWithOAuth: h.canonicalOAuth, setSession: h.setSession, signOut: h.signOut,
      getSession: h.getSession,
      onAuthStateChange: (callback: typeof h.subscriber) => {
        h.subscriber = callback;
        queueMicrotask(() => callback?.("INITIAL_SESSION", h.session));
        return { data: { subscription: { unsubscribe: () => { h.subscriber = null; } } } };
      },
    } };
  }),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: vi.fn(async () => h.bootstrapOffline ? ({ status: "unavailable" })
    : h.session ? ({ status: "local", session: h.session }) : ({ status: "none" })),
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: true, apple: true, microsoft: true }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
  guardSocialAuthProvider: async (_provider: string, start: () => Promise<unknown>) => ({ result: await start() }),
}));
vi.mock("@/lib/deviceAccountSwitch", () => ({
  activateDeviceAccount: h.switchAccount,
  browserDeviceAccountSwitchDeps: () => ({}),
  mintSessionFromRefreshToken: vi.fn(),
}));
vi.mock("@/lib/identityClient", () => ({
  handleClaimRouteAfterSignIn: async () => null,
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => null,
}));
vi.mock("@/lib/authSessionResumeClient", () => ({
  clearPersistedSession: h.clearPersistedSession, persistSessionForResume: async () => "stored", markResumePersisted: () => {},
  resumeAlreadyPersisted: () => true, requestResumeLink: vi.fn(),
}));
import { bindDeviceAccountOwner, deviceAccountOwner, releaseDeviceAccountOwner } from "@/lib/deviceAccountIdentity";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import { bootstrapAuthSession } from "@/lib/authSessionBootstrap";
import { readDeviceAccounts, rememberDeviceAccount } from "@/lib/deviceAccountSessions";
import { readProviderAccountSignal, readProviderAuthState, setProviderAuthState } from "@/lib/authProviderRevision";
import { PLAN_HOST_NAME_KEY, readRememberedPlanHostName, rememberPlanHostName } from "@/lib/planHostName";
import { liveLocationRequest, liveShareSnapshot, reconcileLiveLocationShare, startLiveLocationShare, stopLiveLocationShare } from "@/lib/planLiveLocationShare";
import { memoryPlanStore } from "@/lib/planStore";
import { operatePlanLiveLocation } from "@/lib/planLiveLocationStore";
import { memoryPlanLiveLocations, memoryPlanLiveLocationStops } from "@/lib/planLiveLocationMemory";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";

const token = ["e30", Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "unsigned"].join(".");
const original = { user: { id: "original" }, access_token: token, refresh_token: "original-refresh" } as Session;
const replacement = { user: { id: "replacement" }, access_token: token, refresh_token: "replacement-refresh" } as Session;
let actions: AuthContextValue;
function Probe() {
  const auth = useAuth();
  useEffect(() => { actions = auth; }, [auth]);
  return createElement("output", null, auth.user?.id ?? "signed-out");
}
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
  h.platform = "ios"; h.session = null; h.available = true; h.bootstrapOffline = false; h.clientOffline = false;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, callback: () => Promise<unknown>) => callback() } });
  window.history.replaceState(null, "", "/map");
  h.getSession.mockImplementation(async () => ({ data: { session: h.session }, error: null }));
  h.nativeOAuth.mockResolvedValue({ data: { url: "https://native-auth-test.supabase.co/auth/v1/authorize" }, error: null });
  h.canonicalOAuth.mockResolvedValue({ data: { url: "https://provider.example/authorize" }, error: null });
  h.openBrowser.mockResolvedValue("opened");
  h.exchange.mockResolvedValue({ data: { session: replacement }, error: null });
  h.verify.mockResolvedValue({ data: { user: replacement.user }, error: null });
  h.authenticate.mockImplementation(async ({ attemptId }: { attemptId: string }) => ({ url: `pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=${attemptId}#` }));
  h.setSession.mockImplementation(async () => {
    h.session = replacement;
    h.subscriber?.("SIGNED_IN", replacement);
    return { data: { session: replacement, user: replacement.user }, error: null };
  });
  h.switchAccount.mockImplementation(async (userId: string) => {
    h.session = { ...replacement, user: { ...replacement.user, id: userId } };
    h.subscriber?.("SIGNED_IN", h.session);
    return { status: "switched", userId };
  });
  h.signOut.mockImplementation(async () => { h.session = null; h.subscriber?.("SIGNED_OUT", null); });
  h.clearPersistedSession.mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe))); });
  expect(container.textContent).toBe("signed-out");
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("tab-local private state across account events", () => {
  const rotaKey = "pubmax:wild-round-rota:v1";
  const savedOrder = JSON.stringify({ version: 1, ownerId: "original", rounds: [
    { roundId: "round-a", names: ["Sam", "Priya"], current: 1 },
  ] });

  it.each([
    ["sign out", "active"], ["switch account", "active"],
    ["sign out", "reloaded"], ["switch account", "reloaded"],
  ])("revokes the old seat before %s retires credentials with a %s share", async (action, state) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T20:00:00Z"));
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    const ownerSignal = readProviderAccountSignal();
    const created = await memoryPlanStore.create({ title: "Our night", startTime: new Date().toISOString(), creatorName: "Host", stops: [{ venueId: "a", venueName: "Pub a", position: 0 }] });
    if (!created.ok) throw new Error("Could not create the test Plan.");
    const id = created.plan.plan.id;
    const memberId = created.plan.crew[0]!.id;
    const authority = { kind: "plan" as const, token: created.memberToken };
    const seat = { planId: id, via: "plan" as const, memberToken: created.memberToken };
    let fix!: PositionCallback;
    const clearWatch = vi.fn();
    const watchPosition = vi.fn((success: PositionCallback) => { fix = success; return 7; });
    const geolocation = {
      watchPosition,
      clearWatch,
      getCurrentPosition: vi.fn(),
    } as unknown as Geolocation;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/live-location")) {
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${created.memberToken}`);
        expect(h.session?.user.id).toBe(original.user.id);
        expect(ownerSignal.aborted).toBe(false);
        const result = await operatePlanLiveLocation(id, authority, init?.method === "DELETE" ? "stop" : init?.method === "GET" ? "read" : "share", init?.body ? JSON.parse(String(init.body)) : {});
        return Response.json(result.ok ? result.view : result, { status: result.ok ? 200 : 503 });
      }
      return Response.json({ access_token: replacement.access_token, refresh_token: replacement.refresh_token });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      if (state === "reloaded") {
        expect((await operatePlanLiveLocation(id, authority, "share", { latitude: 51.5, longitude: -0.13, accuracyM: 10 })).ok).toBe(true);
        expect(liveShareSnapshot(id).status).toBe("off");
        reconcileLiveLocationShare(seat, await (await liveLocationRequest(seat, "GET")).json());
      } else {
        startLiveLocationShare(seat, { geolocation });
        fix({ coords: { latitude: 51.5, longitude: -0.13, accuracy: 10 } } as GeolocationPosition);
        await vi.waitFor(() => expect(liveShareSnapshot(id).status).toBe("on"));
      }
      expect(memoryPlanLiveLocations.get(id)?.has(memberId)).toBe(true);
      if (action === "switch account") {
        const real = await vi.importActual<typeof import("@/lib/deviceAccountSwitch")>("@/lib/deviceAccountSwitch");
        rememberDeviceAccount(localStorage, { userId: replacement.user.id, refreshToken: replacement.refresh_token }, Date.now());
        h.switchAccount.mockImplementationOnce((userId: string) => real.activateDeviceAccount(userId, {
          ...real.browserDeviceAccountSwitchDeps(), authConfig: { url: "https://auth.example", key: "publishable-key" },
        }));
      }
      await act(async () => {
        if (action === "sign out") await actions.signOut("device");
        else expect(await actions.switchAccount(replacement.user.id)).toEqual({ status: "switched", userId: replacement.user.id });
      });
      expect(ownerSignal.aborted).toBe(true);
      if (state === "reloaded") {
        expect(watchPosition).not.toHaveBeenCalled();
        expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
      } else expect(clearWatch).toHaveBeenCalledWith(7);
      expect(memoryPlanLiveLocations.has(id)).toBe(false);
      expect(memoryPlanLiveLocationStops.get(id)?.get(memberId)).toMatchObject({ stoppedAt: Date.now() });
      expect(await operatePlanLiveLocation(id, authority, "share", { latitude: 51.6, longitude: -0.13, accuracyM: 10 })).toEqual({ ok: false, error: "stopped" });
      expect(container.textContent).toBe(action === "sign out" ? "signed-out" : replacement.user.id);
    } finally {
      await stopLiveLocationShare(seat, { request: async () => new Response("{}") });
      visibility.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("clears recovered Plan inputs on provider sign-out before another account signs in", async () => {
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    const planKeys = ["pubmaxx:plan-route-draft:v1", "pubmax:plan-route-draft:v2", "pubmax:plan-intake:v1"];
    for (const key of planKeys) localStorage.setItem(key, "account-a-plan-input");
    rememberPlanHostName(localStorage, "Account A host");
    expect(readRememberedPlanHostName(localStorage)).toBe("Account A host");
    const retained = {
      pubmax_pub_pal_v1: "saved-pal",
      "pubmax:pal-quest-stamps:v1": "quest-stamps",
      "pubmax:optimistic-spill-posts:v1": "pending-pint-drop",
      "pubmaxx.night-profile.v1:device": JSON.stringify({ source: "account", profile: "account-a-profile" }),
    };
    for (const [key, value] of Object.entries(retained)) localStorage.setItem(key, value);
    await act(async () => { h.session = null; h.subscriber?.("SIGNED_OUT", null); });
    for (const key of planKeys) expect(localStorage.getItem(key)).toBeNull();
    expect(readRememberedPlanHostName(localStorage)).toBe("");
    for (const [key, value] of Object.entries(retained)) expect(localStorage.getItem(key)).toBe(value);
    expect(deviceAccountOwner(localStorage)).toBe(original.user.id);
    await act(async () => { h.session = replacement; h.subscriber?.("SIGNED_IN", replacement); });
    expect(container.textContent).toBe("replacement");
    expect(readRememberedPlanHostName(localStorage)).toBe("");
    expect(localStorage.getItem("pubmaxx:plan-route-draft:v1")).toBeNull();
    expect(localStorage.getItem("pubmax:plan-intake:v1")).toBeNull();
  });

  it("clears Plan inputs before the provider and cookie sign-out requests finish", async () => {
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    localStorage.setItem("pubmaxx:plan-route-draft:v1", "account-a-route");
    localStorage.setItem("pubmax:plan-intake:v1", "account-a-accessibility");
    rememberPlanHostName(localStorage, "Account A host");
    let finishProvider!: () => void;
    let finishCookie!: () => void;
    h.signOut.mockImplementation(() => new Promise<void>((resolve) => { finishProvider = resolve; }));
    h.clearPersistedSession.mockImplementation(() => new Promise<void>((resolve) => { finishCookie = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = actions.signOut("device"); });
    expect(container.textContent).toBe("signed-out");
    expect(localStorage.getItem("pubmaxx:plan-route-draft:v1")).toBeNull();
    expect(localStorage.getItem("pubmax:plan-intake:v1")).toBeNull();
    expect(localStorage.getItem(PLAN_HOST_NAME_KEY)).toBeNull();
    await act(async () => { finishProvider(); });
    expect(h.clearPersistedSession).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("signed-out");
    await act(async () => { finishCookie(); await pending; });
  });

  it("clears this tab's names when another tab has already stamped the replacement account", async () => {
    h.platform = null;
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    sessionStorage.setItem(rotaKey, savedOrder);
    rememberPlanHostName(localStorage, "Account A host");
    await act(async () => { h.subscriber?.("TOKEN_REFRESHED", original); });
    expect(sessionStorage.getItem(rotaKey)).toBe(savedOrder);
    expect(readRememberedPlanHostName(localStorage)).toBe("Account A host");

    // Another tab shares localStorage, but cannot clear this tab's sessionStorage.
    bindDeviceAccountOwner("replacement", localStorage);
    localStorage.setItem("pubmax_handle", "replacement_owner");
    rememberPlanHostName(localStorage, "Account A host");
    await act(async () => { h.session = replacement; h.subscriber?.("SIGNED_IN", replacement); });
    expect(container.textContent).toBe("replacement");
    expect(sessionStorage.getItem(rotaKey)).toBeNull();
    expect(deviceAccountOwner(localStorage)).toBe("replacement");
    expect(localStorage.getItem("pubmax_handle")).toBe("replacement_owner");
    expect(readRememberedPlanHostName(localStorage)).toBe("");

    bindDeviceAccountOwner("original", localStorage);
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    expect(sessionStorage.getItem(rotaKey)).toBeNull();
  });

  it("clears this tab's names after a sign-out from another tab", async () => {
    h.platform = null;
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    sessionStorage.setItem(rotaKey, savedOrder);
    releaseDeviceAccountOwner(localStorage);
    await act(async () => { h.session = null; h.subscriber?.("SIGNED_OUT", null); });
    expect(container.textContent).toBe("signed-out");
    expect(sessionStorage.getItem(rotaKey)).toBeNull();
    expect(deviceAccountOwner(localStorage)).toBeNull();
  });

  it("keeps this tab's names during an ordinary same-account provider remount", async () => {
    h.platform = null;
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    sessionStorage.setItem(rotaKey, savedOrder);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => { root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe))); });
    expect(container.textContent).toBe("original");
    expect(sessionStorage.getItem(rotaKey)).toBe(savedOrder);
  });
});

describe("AuthProvider's installed iPhone OAuth consumer", () => {
  it.each([
    ["signInWithGoogle", "google"], ["signInWithApple", "apple"], ["signInWithMicrosoft", "azure"],
  ] as const)("uses the isolated native flow for %s and renders its canonical session", async (method, provider) => {
    await act(async () => { expect(await actions[method]()).toEqual({ error: null }); });
    expect(h.nativeOAuth.mock.calls[0]?.[0].provider).toBe(provider);
    expect(h.canonicalOAuth).not.toHaveBeenCalled();
    expect(h.authenticate).toHaveBeenCalledOnce();
    expect(h.setSession).toHaveBeenCalledWith({ access_token: token, refresh_token: "replacement-refresh" });
    expect(container.textContent).toBe("replacement");
  });

  it.each([null, "android"] as const)("keeps the canonical flow on %s", async (platform) => {
    h.platform = platform;
    // The web page itself leaves for the provider; Android hands off to the system browser and stays.
    await act(async () => {
      expect(await actions.signInWithGoogle()).toEqual(platform === "android" ? { error: null } : { error: null, navigating: true });
    });
    expect(h.canonicalOAuth).toHaveBeenCalledOnce();
    expect(h.nativeOAuth).not.toHaveBeenCalled();
    expect(h.authenticate).not.toHaveBeenCalled();
    if (platform === "android") expect(h.openBrowser).toHaveBeenCalledOnce();
    else expect(h.openBrowser).not.toHaveBeenCalled();
    expect(container.textContent).toBe("signed-out");
  });

  it("returns an existing account from the login page to its intended profile", async () => {
    window.history.replaceState(null, "", "/login?from=/u/you");
    await act(async () => { expect(await actions.signInWithGoogle("/u/you")).toEqual({ error: null }); });
    expect(h.navigate).toHaveBeenCalledWith("/u/you");
  });

  it("restores the initiating tab's return fragment after native sign-in", async () => {
    window.history.replaceState(null, "", "/map?area=soho#invite-secret");
    await act(async () => { expect(await actions.signInWithGoogle()).toEqual({ error: null }); });
    expect(h.navigate).toHaveBeenCalledWith("/map?area=soho#invite-secret");
    expect(h.nativeOAuth.mock.calls[0]?.[0].options.redirectTo).not.toContain("invite-secret");
    expect(h.authenticate.mock.calls[0]?.[0].url).not.toContain("invite-secret");
  });

  it.each(["unresolved", "unavailable"] as const)("refuses native sign-in while the canonical state is %s", async (state) => {
    await act(async () => { setProviderAuthState("supabase", state); });
    await act(async () => { expect((await actions.signInWithGoogle()).error).toMatch(/could not be confirmed/); });
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(h.nativeOAuth).not.toHaveBeenCalled();
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("explains that an old installed binary needs an update", async () => {
    h.available = false;
    await act(async () => { expect((await actions.signInWithGoogle()).error).toMatch(/Update the iPhone app/); });
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(h.nativeOAuth).not.toHaveBeenCalled();
    expect(h.canonicalOAuth).not.toHaveBeenCalled();
  });

  it.each([
    ["signInWithGoogle", "google"], ["signInWithApple", "apple"], ["signInWithMicrosoft", "azure"],
  ] as const)("preserves the existing signed-in Add account path for %s", async (method, provider) => {
    window.history.replaceState(null, "", "/login?add=1&from=/u/you");
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    h.available = false;
    await act(async () => { expect(await actions[method]("/u/you")).toEqual({ error: null }); });
    expect(h.canonicalOAuth).toHaveBeenCalledOnce();
    const request = h.canonicalOAuth.mock.calls[0]![0];
    expect(request.provider).toBe(provider);
    expect(request.options.skipBrowserRedirect).toBe(true);
    expect(new URL(request.options.redirectTo).searchParams.has("native")).toBe(false);
    expect(h.openBrowser).toHaveBeenCalledOnce();
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(h.nativeOAuth).not.toHaveBeenCalled();
    expect(h.setSession).not.toHaveBeenCalled();
    expect(container.textContent).toBe("original");
  });

  it("does not send a superseded delayed Add account read into the legacy provider flow", async () => {
    window.history.replaceState(null, "", "/login?add=1");
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    let finish!: (value: unknown) => void;
    h.getSession.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    let older!: Promise<{ error: string | null }>;
    await act(async () => { older = actions.signInWithGoogle(); });
    await vi.waitFor(() => expect(h.getSession).toHaveBeenCalledOnce());
    await act(async () => { expect(await actions.signInWithApple()).toEqual({ error: null }); });
    await act(async () => { finish({ data: { session: original }, error: null }); await older; });
    expect(h.canonicalOAuth).toHaveBeenCalledOnce();
    expect(h.canonicalOAuth.mock.calls[0]![0].provider).toBe("apple");
    expect(h.nativeOAuth).not.toHaveBeenCalled();
  });

  it.each(["/map?add=1", "/login?add=true", "/login?add=1&add=1"])("refuses a broad signed-in fallback from %s", async (path) => {
    window.history.replaceState(null, "", path);
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    await act(async () => { expect((await actions.signInWithGoogle()).error).toMatch(/already signed in/); });
    expect(h.canonicalOAuth).not.toHaveBeenCalled();
    expect(h.nativeOAuth).not.toHaveBeenCalled();
  });

  it("preserves an existing account and directs account changes to Switch account", async () => {
    window.history.replaceState(null, "", "/login");
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    await act(async () => { expect((await actions.signInWithGoogle()).error).toMatch(/already signed in/); });
    expect(h.nativeOAuth).not.toHaveBeenCalled();
    expect(h.setSession).not.toHaveBeenCalled();
    expect(container.textContent).toBe("original");
  });

  it.each([
    ["client", "online"], ["client", "visible"], ["client", "focus"],
    ["session", "online"], ["session", "visible"], ["session", "focus"],
    ["session retry", "online"], ["session retry", "visible"], ["session retry", "focus"],
  ])("retains %s recovery from %s while the attempt is pending", async (stage, event) => {
    await act(async () => root.unmount());
    setProviderAuthState("supabase", "unresolved");
    h.bootstrapOffline = stage === "session retry";
    let failBootstrap!: (error: Error) => void;
    const pendingBootstrap = new Promise<never>((_resolve, reject) => { failBootstrap = reject; });
    if (stage === "client") {
      vi.mocked(ensureSupabaseBrowser).mockImplementationOnce(() => new Promise(() => {}));
    } else if (stage === "session") {
      vi.mocked(bootstrapAuthSession).mockReturnValueOnce(pendingBootstrap);
    }
    root = createRoot(container);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    try {
      await act(async () => {
        root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe)));
      });
      if (stage === "session retry") {
        expect(readProviderAuthState("supabase")).toBe("unavailable");
        vi.mocked(bootstrapAuthSession).mockReturnValueOnce(pendingBootstrap);
        await act(async () => { window.dispatchEvent(new Event("focus")); });
        h.bootstrapOffline = false;
      }
      await act(async () => {
        if (event === "visible") document.dispatchEvent(new Event("visibilitychange"));
        else window.dispatchEvent(new Event(event));
        await vi.runAllTimersAsync();
      });
      if (stage !== "client") {
        expect(readProviderAuthState("supabase")).toBe("unavailable");
        await act(async () => { failBootstrap(new Error("offline resume read")); });
      }
      expect(readProviderAuthState("supabase")).toBe("signed-out");
      await act(async () => { expect(await actions.signInWithApple()).toEqual({ error: null }); });
      expect(container.textContent).toBe("replacement");
      expect(h.authenticate).toHaveBeenCalledTimes(1);
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each([
    ["client", "online"], ["client", "visible"], ["client", "focus"],
    ["session", "online"], ["session", "visible"], ["session", "focus"],
  ])("recovers native sign-in after an offline %s boot on %s", async (stage, event) => {
    await act(async () => root.unmount());
    setProviderAuthState("supabase", "unresolved");
    h.clientOffline = stage === "client";
    h.bootstrapOffline = stage === "session";
    root = createRoot(container);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const wake = () => {
      if (event === "visible") document.dispatchEvent(new Event("visibilitychange"));
      else window.dispatchEvent(new Event(event));
    };
    try {
      await act(async () => {
        root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe)));
      });
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(readProviderAuthState("supabase")).toBe("unavailable");
      await act(async () => { wake(); await vi.runAllTimersAsync(); });
      expect(readProviderAuthState("supabase")).toBe("unavailable");

      h.clientOffline = false;
      h.bootstrapOffline = false;
      await act(async () => { expect((await actions.signInWithApple()).error).toMatch(/could not be confirmed/); });
      expect(h.authenticate).not.toHaveBeenCalled();
      await act(async () => { wake(); await vi.runAllTimersAsync(); });
      expect(readProviderAuthState("supabase")).toBe("signed-out");
      await act(async () => { expect(await actions.signInWithApple()).toEqual({ error: null }); });
      expect(container.textContent).toBe("replacement");
      expect(h.authenticate).toHaveBeenCalledTimes(1);
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps the signed-out state when the user cancels the native session", async () => {
    h.authenticate.mockRejectedValue(new Error("cancelled"));
    await act(async () => { expect((await actions.signInWithGoogle()).error).toMatch(/could not be completed/); });
    expect(h.setSession).not.toHaveBeenCalled();
    expect(container.textContent).toBe("signed-out");
  });

  // A provider sign-in sends no link, so its failure may not blame one.
  it("does not blame an email link when the provider sheet closes or fails", async () => {
    h.authenticate.mockRejectedValue(new Error("Sign-in was cancelled or could not be completed."));
    let result!: Awaited<ReturnType<AuthContextValue["signInWithGoogle"]>>;
    await act(async () => { result = await actions.signInWithGoogle(); });
    expect(result).toEqual({ error: "Sign-in was cancelled or could not be completed. Try again." });
  });

  it("preserves a restored account that arrives before the native exchange finishes", async () => {
    let finish!: (value: unknown) => void;
    h.exchange.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<{ error: string | null }>;
    await act(async () => { pending = actions.signInWithGoogle(); });
    await vi.waitFor(() => expect(h.exchange).toHaveBeenCalledOnce());
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    await act(async () => { finish({ data: { session: replacement }, error: null }); await pending; });
    expect(h.setSession).not.toHaveBeenCalled();
    expect(container.textContent).toBe("original");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("finishes sign-out after an already-started canonical installation and prevents late navigation", async () => {
    let finish!: () => void;
    h.setSession.mockImplementation(() => new Promise((resolve) => { finish = () => {
      h.session = replacement;
      h.subscriber?.("SIGNED_IN", replacement);
      resolve({ data: { session: replacement, user: replacement.user }, error: null });
    }; }));
    let pending!: Promise<{ error: string | null }>;
    await act(async () => { pending = actions.signInWithGoogle(); });
    await vi.waitFor(() => expect(h.setSession).toHaveBeenCalledOnce());
    let signOut!: Promise<void>;
    await act(async () => { signOut = actions.signOut("device"); });
    expect(h.signOut).not.toHaveBeenCalled();
    await act(async () => { finish(); await pending; await signOut; });
    expect(h.signOut).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("signed-out");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("finishes an explicit account switch after a started native installation", async () => {
    let finish!: () => void;
    h.setSession.mockImplementation(() => new Promise((resolve) => { finish = () => {
      h.session = replacement;
      h.subscriber?.("SIGNED_IN", replacement);
      resolve({ data: { session: replacement, user: replacement.user }, error: null });
    }; }));
    let pending!: Promise<{ error: string | null }>;
    await act(async () => { pending = actions.signInWithGoogle(); });
    await vi.waitFor(() => expect(h.setSession).toHaveBeenCalledOnce());
    let switched!: ReturnType<AuthContextValue["switchAccount"]>;
    await act(async () => { switched = actions.switchAccount("selected-account"); });
    expect(h.switchAccount).not.toHaveBeenCalled();
    await act(async () => { finish(); await pending; await switched; });
    expect(container.textContent).toBe("selected-account");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it.each(["account", "device"] as const)("forgets the signed-out %s rows after a final provider refresh", async (scope) => {
    await act(async () => {
      h.session = original;
      h.subscriber?.("SIGNED_IN", original);
    });
    rememberDeviceAccount(localStorage, {
      userId: replacement.user.id, refreshToken: replacement.refresh_token,
    }, Date.now());
    // A provider can finish an in-flight refresh before its sign-out request resolves.
    h.signOut.mockImplementation(async () => {
      h.subscriber?.("TOKEN_REFRESHED", original);
      h.session = null;
      h.subscriber?.("SIGNED_OUT", null);
    });
    await act(async () => { await actions.signOut(scope); });
    expect(readDeviceAccounts(localStorage).map((row) => row.userId)).toEqual(
      scope === "device" ? [] : [replacement.user.id],
    );
    expect(container.textContent).toBe(scope === "device" ? "signed-out" : replacement.user.id);
    expect(deviceAccountOwner(localStorage)).toBe(scope === "device" ? null : replacement.user.id);
  });

  it("does not resurrect an account after explicit sign-out during the code exchange", async () => {
    let finish!: (value: unknown) => void;
    h.exchange.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<{ error: string | null }>;
    await act(async () => { pending = actions.signInWithGoogle(); });
    await vi.waitFor(() => expect(h.exchange).toHaveBeenCalledOnce());
    await act(async () => { await actions.signOut("device"); });
    await act(async () => { finish({ data: { session: replacement }, error: null }); await pending; });
    expect(h.setSession).not.toHaveBeenCalled();
    expect(container.textContent).toBe("signed-out");
    expect(h.cancel).toHaveBeenCalledOnce();
  });
});
