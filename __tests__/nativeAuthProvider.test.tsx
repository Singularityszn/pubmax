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
  session: null as Session | null,
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
  ensureSupabaseBrowser: async () => ({ auth: {
    signInWithOAuth: h.canonicalOAuth, setSession: h.setSession, signOut: h.signOut,
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
  clearPersistedSession: async () => {}, persistSessionForResume: async () => "stored", markResumePersisted: () => {},
  resumeAlreadyPersisted: () => true, requestResumeLink: vi.fn(),
}));
import { setProviderAuthState } from "@/lib/authProviderRevision";
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
  h.platform = "ios"; h.session = null; h.available = true;
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
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe))); });
  expect(container.textContent).toBe("signed-out");
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
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
    await act(async () => { expect(await actions.signInWithGoogle()).toEqual({ error: null }); });
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

  it("keeps the signed-out state when the user cancels the native session", async () => {
    h.authenticate.mockRejectedValue(new Error("cancelled"));
    await act(async () => { expect((await actions.signInWithGoogle()).error).toMatch(/could not be completed/); });
    expect(h.setSession).not.toHaveBeenCalled();
    expect(container.textContent).toBe("signed-out");
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
