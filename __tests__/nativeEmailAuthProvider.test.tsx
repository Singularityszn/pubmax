// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://pubmaxxing.com"}
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/components/auth/authContext";

const h = vi.hoisted(() => ({
  platform: "ios" as "ios" | "android" | null,
  realIdentity: false,
  realAuth: null as SupabaseClient | null, persist: vi.fn(), stopAutoRefresh: vi.fn(),
  navigate: vi.fn(), available: true, switchAccount: vi.fn(), canonicalEmail: vi.fn(),
  listeners: new Set<(event: { url: string }) => void>(), launchUrl: null as string | null,
  bootstrap: vi.fn(), tokenRequests: 0, referralBodies: [] as Record<string, unknown>[], tokenDelay: null as Promise<unknown> | null, resumeBody: null as null | Record<string, unknown>,
  identityRequests: 0, identityDelay: null as Promise<unknown> | null, referralDelay: null as Promise<unknown> | null,
  callbackUrl: "", otpBody: null as null | Record<string, unknown>, tokenBody: null as null | Record<string, unknown>,
  canonicalOAuth: vi.fn(), getSession: vi.fn(), nativeOAuth: vi.fn(), exchange: vi.fn(), verify: vi.fn(),
  authenticate: vi.fn(), setSession: vi.fn(), signOut: vi.fn(), cancel: vi.fn(), openBrowser: vi.fn(),
  session: null as Session | null,
  subscriber: null as null | ((event: string, session: Session | null) => void),
}));
vi.mock("@capacitor/app", () => ({ App: {
  addListener: async (_name: string, listener: (event: { url: string }) => void) => { h.listeners.add(listener); return { remove: async () => { h.listeners.delete(listener); } }; },
  getLaunchUrl: async () => h.launchUrl ? { url: h.launchUrl } : null,
} }));
vi.mock("next/navigation", () => { const router = { push: h.navigate }; return { useRouter: () => router }; });
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
  createNativeAuthClient: async () => ({ auth: { signInWithOAuth: h.nativeOAuth, exchangeCodeForSession: h.exchange, getUser: h.verify, stopAutoRefresh: h.stopAutoRefresh } }),
  isAuthConfigured: () => true,
  getAccessToken: async () => (h.realAuth ? (await h.realAuth.auth.getSession()).data.session : h.session)?.access_token ?? null,
  ensureSupabaseBrowser: async () => h.realAuth ?? ({ auth: {
    signInWithOAuth: h.canonicalOAuth, signInWithOtp: h.canonicalEmail, setSession: h.setSession, signOut: h.signOut,
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
  bootstrapAuthSession: h.bootstrap,
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
vi.mock("@/lib/identityClient", async (original) => {
  const actual = await original<typeof import("@/lib/identityClient")>();
  return {
    ...actual,
    IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
    identityHandleForOwner: (...args: Parameters<typeof actual.identityHandleForOwner>) =>
      h.realIdentity ? actual.identityHandleForOwner(...args) : null,
    resolveCanonicalIdentity: async (...args: Parameters<typeof actual.resolveCanonicalIdentity>) =>
      h.realIdentity ? actual.resolveCanonicalIdentity(...args) : ({ ok: true, identity: null }),
  };
});
vi.mock("@/lib/authSessionResumeClient", async (original) => ({
  ...await original<typeof import("@/lib/authSessionResumeClient")>(),
  clearPersistedSession: async () => {}, persistSessionForResume: h.persist, markResumePersisted: () => {},
  resumeAlreadyPersisted: () => true,
}));
import { setProviderAuthState } from "@/lib/authProviderRevision";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";

const token = ["e30", Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "unsigned"].join(".");
const original = { user: { id: "original" }, access_token: token, refresh_token: "original-refresh" } as Session;
const replacement = { user: { id: "replacement", email: "native@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" }, access_token: token, refresh_token: "replacement-refresh" } as Session;
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
  h.platform = "ios"; h.realIdentity = false; h.session = null; h.realAuth = null; h.available = true; h.persist.mockResolvedValue("stored"); h.stopAutoRefresh.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, callback: () => Promise<unknown>) => callback() } });
  window.history.replaceState(null, "", "/map");
  h.listeners.clear(); h.launchUrl = null; h.callbackUrl = ""; h.otpBody = null; h.tokenBody = null; h.tokenRequests = 0; h.referralBodies = []; h.tokenDelay = null; h.resumeBody = null;
  h.identityRequests = 0; h.identityDelay = null; h.referralDelay = null;
  h.bootstrap.mockImplementation(async () => h.session ? ({ status: "local", session: h.session }) : ({ status: "none" }));
  h.canonicalEmail.mockImplementation(async ({ options }: { options: { emailRedirectTo: string } }) => { h.callbackUrl = options.emailRedirectTo; return { error: null }; });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://native-email-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_offline_fixture");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.href);
    if (url.pathname === "/api/auth/referral-signup-proof") return Response.json({ proof: "trusted-referral-proof" });
    if (url.pathname === "/api/referrals/claim-attribution") {
      h.referralBodies.push(JSON.parse(String(init?.body)));
      if (h.referralDelay) await h.referralDelay;
      return Response.json({ inviterHandle: "friend" });
    }
    if (url.pathname === "/api/identity/handle/current") {
      h.identityRequests += 1;
      if (h.identityDelay) await h.identityDelay;
      return Response.json({ handle: "email_owner" });
    }
    if (url.pathname === "/auth/v1/otp") {
      h.callbackUrl = url.searchParams.get("redirect_to") ?? "";
      h.otpBody = JSON.parse(String(init?.body));
      return Response.json({});
    }
    if (url.pathname === "/auth/v1/token") {
      h.tokenRequests += 1;
      if (h.tokenDelay) await h.tokenDelay;
      h.tokenBody = JSON.parse(String(init?.body));
      return Response.json({ ...replacement, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    if (url.pathname === "/api/auth/session" && init?.method === "POST") {
      h.resumeBody = JSON.parse(String(init.body));
      h.callbackUrl = String(h.resumeBody?.callbackUrl);
      return Response.json({ status: "sent", message: "Check your email." });
    }
    if (url.pathname === "/auth/v1/user") return Response.json(replacement.user);
    return Response.json({});
  });
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
  expect(container.querySelector("output")?.textContent).toBe("signed-out");
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});


import { GET } from "@/app/auth/callback/route";
import { createHash } from "node:crypto";

import { activateNativeDeepLinks } from "@/lib/nativeDeepLinks";
import { NATIVE_EMAIL_RECEIPT_KEY } from "@/lib/nativeEmailPkce";
import { beginCoordinatedAuthAttempt } from "@/lib/authRedirect";
import { readDeviceAccounts } from "@/lib/deviceAccountSessions";

async function emailCallback(code = "one-use-email-code") {
  const callback = new URL(h.callbackUrl);
  callback.searchParams.set("code", code);
  return (await GET(new Request(callback))).headers.get("location")!;
}
async function openApp(url: string) {
  await act(async () => { for (const listener of h.listeners) listener({ url }); await Promise.resolve(); });
}
async function resetDocument(launchUrl: string, bootstrap?: Promise<unknown>) {
  await act(async () => root.unmount());
  sessionStorage.clear();
  window.history.replaceState(null, "", "/app-entry");
  h.launchUrl = launchUrl;
  if (bootstrap) h.bootstrap.mockReturnValue(bootstrap);
  root = createRoot(container);
  await act(async () => root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe))));
}
function queueAuthLocks() {
  const queued: (() => Promise<void>)[] = [];
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: (_name: string, callback: () => Promise<unknown>) => new Promise((resolve, reject) => {
      queued.push(async () => { try { resolve(await callback()); } catch (error) { reject(error); } });
    }),
  } });
  return queued;
}

describe("installed iPhone email link, relay and App consumer", () => {
  it("returns the email session into the initiating app instead of leaving it signed out", async () => {
    await act(async () => { expect((await actions.signInWithEmail(" Native@Example.Test ", "/u/you")).status).toBe("sent"); });
    const callback = new URL(h.callbackUrl);
    callback.searchParams.set("code", "one-use-email-code");
    const response = await GET(new Request(callback));
    const location = response.headers.get("location")!;
    await act(async () => {
      for (const listener of h.listeners) listener({ url: location });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"), { timeout: 1000 });
    expect(location).toMatch(/^pubmaxx:\/\/native-email\/callback\?/);
    expect(h.canonicalEmail).not.toHaveBeenCalled();
    expect(h.otpBody?.email).toBe("native@example.test");
    expect(h.tokenBody?.auth_code).toBe("one-use-email-code");
    expect(createHash("sha256").update(String(h.tokenBody?.code_verifier)).digest("base64url")).toBe(h.otpBody?.code_challenge);
    expect(h.navigate).toHaveBeenCalledWith("/u/you");
  });
  it("completes a cold App launch after the initiating document and tab storage disappear", async () => {
    window.history.replaceState(null, "", "/map?area=soho#invite-secret");
    await act(async () => { expect((await actions.signInWithEmail("native@example.test")).status).toBe("sent"); });
    const receipt = JSON.parse(localStorage.getItem(NATIVE_EMAIL_RECEIPT_KEY)!);
    expect(Object.keys(receipt).sort()).toEqual(["authOrigin", "callbackUrl", "createdAt", "expectedEmail", "expiresAt", "id", "verifier", "version"]);
    expect(JSON.stringify(receipt)).not.toContain("replacement-refresh");
    expect(JSON.stringify(receipt)).not.toContain(token);
    const launch = await emailCallback();
    await resetDocument(launch);
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"));
    expect(h.tokenRequests).toBe(1);
    expect(localStorage.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull();
    expect(h.navigate).toHaveBeenCalledWith("/map?area=soho#invite-secret");
  });
  it("can explicitly replace a legacy implicit attempt after a cold native upgrade", async () => {
    const old = await beginCoordinatedAuthAttempt(window.location.href, "/map#old-fragment", {
      persistentStorage: localStorage, tabStorage: sessionStorage,
      lockManager: navigator.locks, cryptoProvider: crypto,
    });
    if (!old.ok) throw new Error(old.message);
    expect(localStorage.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull();
    await resetDocument("");
    await act(async () => { expect((await actions.signInWithEmail("native@example.test", "/u/you")).status).toBe("sent"); });
    expect(new URL(h.callbackUrl).searchParams.get("_authAttempt")).not.toBe(old.id);
    expect(new URL(h.callbackUrl).searchParams.get("native")).toBe("ios-email-pkce");
    await openApp(await emailCallback());
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"));
    expect(h.navigate).toHaveBeenCalledWith("/u/you");
  });
  it.each(["cancel", "restored-account"] as const)("cannot restart a queued native claim after %s", async (change) => {
    const queued = queueAuthLocks();
    let pending!: ReturnType<AuthContextValue["signInWithEmail"]>;
    await act(async () => { pending = actions.signInWithEmail("native@example.test"); });
    await vi.waitFor(() => expect(queued).toHaveLength(1));
    await act(async () => {
      if (change === "cancel") actions.cancelAuthAttempt();
      else { h.session = original; h.subscriber?.("SIGNED_IN", original); }
      await queued[0]!();
    });
    expect((await pending).status).toBe("error");
    expect(localStorage.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull();
    expect(localStorage.getItem("pubmax_auth_active_attempt")).toBeNull();
    expect(h.otpBody).toBeNull();
  });
  it("only lets the current native start replace the claim when concurrent requests queue", async () => {
    const queued = queueAuthLocks();
    let first!: ReturnType<AuthContextValue["signInWithEmail"]>;
    let second!: ReturnType<AuthContextValue["signInWithEmail"]>;
    await act(async () => { first = actions.signInWithEmail("earlier@example.test"); });
    await vi.waitFor(() => expect(queued).toHaveLength(1));
    await act(async () => { second = actions.signInWithEmail("native@example.test", "/u/you"); });
    await vi.waitFor(() => expect(queued).toHaveLength(2));
    await act(async () => { await queued[0]!(); });
    expect((await first).status).toBe("error");
    expect(h.otpBody).toBeNull();
    await act(async () => { await queued[1]!(); await second; });
    expect((await second).status).toBe("sent");
    expect(h.otpBody?.email).toBe("native@example.test");
    const receipt = JSON.parse(localStorage.getItem(NATIVE_EMAIL_RECEIPT_KEY)!);
    expect(receipt.expectedEmail).toBe("native@example.test");
    expect(receipt.id).toBe(new URL(h.callbackUrl).searchParams.get("_authAttempt"));
  });

  it("holds a cold callback until auth bootstrap settles and deduplicates its warm App event", async () => {
    await act(async () => { await actions.signInWithEmail("native@example.test", "/u/you"); });
    const launch = await emailCallback();
    let settle!: (value: unknown) => void;
    const bootstrap = new Promise((resolve) => { settle = resolve; });
    await resetDocument(launch, bootstrap);
    await openApp(launch);
    expect(h.tokenRequests).toBe(0);
    expect(h.setSession).not.toHaveBeenCalled();
    await act(async () => { settle({ status: "none" }); });
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"));
    expect(h.tokenRequests).toBe(1);
    expect(h.setSession).toHaveBeenCalledOnce();
  });

  it("deduplicates repeated App URLs while the first exchange is in flight", async () => {
    await act(async () => { await actions.signInWithEmail("native@example.test", "/u/you"); });
    const callback = await emailCallback();
    let finish!: () => void;
    h.tokenDelay = new Promise<void>((resolve) => { finish = resolve; });
    await openApp(callback);
    await vi.waitFor(() => expect(h.tokenRequests).toBe(1));
    await openApp(callback);
    expect(h.tokenRequests).toBe(1);
    await act(async () => { finish(); });
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"));
    expect(h.setSession).toHaveBeenCalledOnce();
  });

  it("uses the same PKCE return for a masked welcome-back resume", async () => {
    await act(async () => { expect((await actions.resumeSignIn("/u/you")).status).toBe("sent"); });
    expect(h.resumeBody?.action).toBe("resume");
    expect(h.resumeBody).not.toHaveProperty("email");
    await openApp(await emailCallback());
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"));
    expect(createHash("sha256").update(String(h.tokenBody?.code_verifier)).digest("base64url")).toBe(h.resumeBody?.codeChallenge);
  });

  it.each(["cancel", "sign-out"] as const)("refuses a callback after explicit %s", async (action) => {
    await act(async () => { await actions.signInWithEmail("native@example.test"); });
    const callback = await emailCallback();
    await act(async () => { if (action === "cancel") actions.cancelAuthAttempt(); else await actions.signOut("device"); });
    await openApp(callback);
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    expect(h.tokenRequests).toBe(0);
    expect(h.setSession).not.toHaveBeenCalled();
    expect(localStorage.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull();
  });

  it("refuses a restored account before native installation", async () => {
    await act(async () => { await actions.signInWithEmail("native@example.test"); });
    const callback = await emailCallback();
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    await openApp(callback);
    expect(container.querySelector("output")?.textContent).toBe("original");
    expect(h.tokenRequests).toBe(0);
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("ignores the earlier email after a same-app request supersedes it", async () => {
    await act(async () => { await actions.signInWithEmail("native@example.test"); });
    const earlier = await emailCallback("earlier-code");
    await act(async () => { await actions.signInWithEmail("native@example.test"); });
    const current = await emailCallback("current-code");
    await openApp(earlier);
    expect(h.tokenRequests).toBe(0);
    await openApp(current);
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"));
    expect(h.tokenBody?.auth_code).toBe("current-code");
  });

  it("refuses a changed public auth project after a cold return", async () => {
    await act(async () => { await actions.signInWithEmail("native@example.test"); });
    const callback = await emailCallback();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://different-project.supabase.co");
    await resetDocument(callback);
    expect(h.tokenRequests).toBe(0);
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it.each(["unresolved", "unavailable"] as const)("does not send native email while auth is %s", async (state) => {
    await act(async () => { setProviderAuthState("supabase", state); });
    await act(async () => { expect((await actions.signInWithEmail("native@example.test")).status).toBe("error"); });
    expect(h.otpBody).toBeNull();
    expect(h.canonicalEmail).not.toHaveBeenCalled();
  });

  it.each([null, "android"] as const)("keeps email implicit on %s", async (platform) => {
    h.platform = platform;
    await act(async () => { expect((await actions.signInWithEmail("native@example.test")).status).toBe("sent"); });
    expect(h.canonicalEmail).toHaveBeenCalledOnce();
    expect(h.otpBody).toBeNull();
    expect(new URL(h.callbackUrl).searchParams.has("native")).toBe(false);
  });
  it("owns a direct HTTPS email event while the ordinary App router leaves it alone", async () => {
    const genericNavigate = vi.fn();
    const stop = await activateNativeDeepLinks(genericNavigate);
    await act(async () => { await actions.signInWithEmail("native@example.test", "/u/you"); });
    const incoming = new URL(h.callbackUrl);
    incoming.searchParams.set("code", "one-use-email-code");
    incoming.searchParams.set("next", "//evil.example/steal");
    incoming.searchParams.set("_referralSignupProof", "untrusted-incoming-proof");
    await openApp(incoming.toString());
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"));
    expect(genericNavigate).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith("/u/you");
    expect(h.tokenRequests).toBe(1);
    stop();
  });

  it("deduplicates direct HTTPS and custom-scheme copies of the same email callback", async () => {
    await act(async () => { await actions.signInWithEmail("native@example.test", "/u/you"); });
    const incoming = new URL(h.callbackUrl); incoming.searchParams.set("code", "one-use-email-code");
    const custom = (await GET(new Request(incoming))).headers.get("location")!;
    let finish!: () => void;
    h.tokenDelay = new Promise<void>((resolve) => { finish = resolve; });
    await openApp(incoming.toString());
    await vi.waitFor(() => expect(h.tokenRequests).toBe(1));
    await openApp(custom);
    await act(async () => { finish(); });
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"));
    expect(h.setSession).toHaveBeenCalledOnce();
  });
  it("ends an owned direct HTTPS expired email without displaying provider prose", async () => {
    const genericNavigate = vi.fn();
    const stop = await activateNativeDeepLinks(genericNavigate);
    await act(async () => { await actions.signInWithEmail("native@example.test"); });
    const incoming = new URL(h.callbackUrl);
    const error = new URLSearchParams({ error: "access_denied", error_code: "otp_expired", error_description: "Untrusted private provider prose" });
    for (const [key, value] of error) incoming.searchParams.set(key, value);
    incoming.hash = new URLSearchParams([...error, ["sb", ""]]).toString();
    await openApp(incoming.toString());
    await vi.waitFor(() => expect(localStorage.getItem(NATIVE_EMAIL_RECEIPT_KEY)).toBeNull());
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    expect(container.textContent).not.toContain("Untrusted private provider prose");
    expect(h.tokenRequests).toBe(0);
    expect(h.setSession).not.toHaveBeenCalled();
    expect(genericNavigate).not.toHaveBeenCalled();
    stop();
  });
  it("retains the original referral proof and consumes its fragment after a cold return", async () => {
    const referral = "validReferralCode123456789";
    window.history.replaceState(null, "", "/map#referral=" + referral + "&invite=kept");
    await act(async () => { expect((await actions.signInWithEmail("native@example.test")).status).toBe("sent"); });
    const attempt = new URL(h.callbackUrl).searchParams.get("_authAttempt");
    await resetDocument(await emailCallback());
    await vi.waitFor(() => expect(h.referralBodies).toHaveLength(1));
    expect(h.referralBodies[0]).toEqual({ code: referral, authAttemptId: attempt, signupProof: "trusted-referral-proof" });
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/map#invite=kept"));
  });

  it("keeps the signed-in Add account email path implicit", async () => {
    window.history.replaceState(null, "", "/login?add=1");
    await act(async () => { h.session = original; h.subscriber?.("SIGNED_IN", original); });
    await act(async () => { expect((await actions.signInWithEmail("native@example.test")).status).toBe("sent"); });
    expect(h.canonicalEmail).toHaveBeenCalledOnce();
    expect(h.otpBody).toBeNull();
    expect(new URL(h.callbackUrl).searchParams.has("native")).toBe(false);
    expect(container.querySelector("output")?.textContent).toBe("original");
  });

  it("does not start the captured account identity read after switching during referral attribution", async () => {
    window.history.replaceState(null, "", "/map#referral=validReferralCode123456789");
    let finish!: () => void;
    h.referralDelay = new Promise<void>((resolve) => { finish = resolve; });
    await act(async () => { await actions.signInWithEmail("native@example.test"); });
    await openApp(await emailCallback());
    await vi.waitFor(() => expect(h.referralBodies).toHaveLength(1));
    await act(async () => { await actions.switchAccount("original"); });
    localStorage.setItem("pubmax_handle", "bob");
    await act(async () => { finish(); await Promise.resolve(); });
    expect(h.identityRequests).toBe(0);
    expect(localStorage.getItem("pubmax_handle")).toBe("bob");
    expect(sessionStorage.getItem("pubmax:referral-follow-handle")).toBeNull();
    expect(h.navigate).not.toHaveBeenCalled();
  });
  it("does not store the captured account handle after switching during the actual identity read", async () => {
    let finish!: () => void;
    h.identityDelay = new Promise<void>((resolve) => { finish = resolve; });
    await act(async () => { await actions.signInWithEmail("native@example.test", "/map"); });
    await openApp(await emailCallback());
    await vi.waitFor(() => expect(h.identityRequests).toBe(1));
    await act(async () => { await actions.switchAccount("original"); });
    localStorage.setItem("pubmax_handle", "bob");
    await act(async () => { finish(); await Promise.resolve(); });
    expect(localStorage.getItem("pubmax_handle")).toBe("bob");
    expect(h.navigate).not.toHaveBeenCalled();
  });
  it("preserves the active account's canonical handle when the provider's previous identity read settles", async () => {
    h.realIdentity = true;
    const defaultFetch = fetch;
    let finish!: () => void;
    let previousReadStarted = false;
    const previousAnswer = new Promise<void>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), window.location.href).pathname !== "/api/identity/handle/current") {
        return defaultFetch(input, init);
      }
      const owner = h.session?.user.id;
      if (owner === "replacement") {
        previousReadStarted = true;
        await previousAnswer;
        return Response.json({ handle: "alice" });
      }
      return Response.json({ handle: "bob" });
    });
    await act(async () => { await actions.signInWithEmail("native@example.test", "/u/you"); });
    await openApp(await emailCallback());
    await vi.waitFor(() => expect(previousReadStarted).toBe(true));
    await act(async () => { await actions.switchAccount("original"); });
    await vi.waitFor(() => expect(actions.handle).toBe("bob"));
    expect(localStorage.getItem("pubmax_handle")).toBe("bob");
    const navigations = [...h.navigate.mock.calls];
    await act(async () => { finish(); await Promise.resolve(); });
    expect(actions.user?.id).toBe("original");
    expect(actions.handle).toBe("bob");
    expect(localStorage.getItem("pubmax_account_owner")).toBe("original");
    expect(localStorage.getItem("pubmax_handle")).toBe("bob");
    expect(h.navigate.mock.calls).toEqual(navigations);
  });
  it("does not install an email result after an account switch during exchange", async () => {
    await act(async () => { await actions.signInWithEmail("native@example.test"); });
    let finish!: () => void;
    h.tokenDelay = new Promise<void>((resolve) => { finish = resolve; });
    await openApp(await emailCallback());
    await vi.waitFor(() => expect(h.tokenRequests).toBe(1));
    await act(async () => { await actions.switchAccount("selected-account"); });
    await act(async () => { finish(); });
    expect(h.setSession).not.toHaveBeenCalled();
    expect(container.querySelector("output")?.textContent).toBe("selected-account");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("finishes explicit sign-out after a started canonical email installation", async () => {
    await act(async () => { await actions.signInWithEmail("native@example.test"); });
    let finish!: () => void;
    h.setSession.mockImplementation(() => new Promise((resolve) => { finish = () => {
      h.session = replacement; h.subscriber?.("SIGNED_IN", replacement);
      resolve({ data: { session: replacement, user: replacement.user }, error: null });
    }; }));
    await openApp(await emailCallback());
    await vi.waitFor(() => expect(h.setSession).toHaveBeenCalledOnce());
    let signedOut!: Promise<void>;
    await act(async () => { signedOut = actions.signOut("device"); });
    expect(h.signOut).not.toHaveBeenCalled();
    await act(async () => { finish(); await signedOut; });
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    expect(h.navigate).not.toHaveBeenCalled();
  });
});


describe("mounted legacy callback account ownership with real identity and referral helpers", () => {
  const a = { ...replacement, access_token: `${token}-account-a` };
  const b = { ...original, access_token: `${token}-account-b` };

  function captureFullNavigation() {
    const browser = window;
    const location = { get href() { return browser.location.href; }, get origin() { return browser.location.origin; }, assign: vi.fn() };
    vi.stubGlobal("window", new Proxy({}, {
      get: (_target, key) => {
        if (key === "location") return location;
        const value = Reflect.get(browser, key, browser);
        return ["addEventListener", "removeEventListener", "dispatchEvent", "setTimeout", "clearTimeout"].includes(String(key))
          ? value.bind(browser) : value;
      },
    }));
    return location.assign;
  }

  async function mountLegacyCallback(withReferral = true) {
    h.platform = null;
    h.realIdentity = true;
    h.setSession.mockImplementation(async () => {
      h.session = a;
      h.subscriber?.("SIGNED_IN", a);
      return { data: { session: a, user: a.user }, error: null };
    });
    window.history.replaceState(null, "", withReferral ? "/map#referral=validReferralCode123456789" : "/map");
    await act(async () => { expect((await actions.signInWithEmail("native@example.test", withReferral ? undefined : "/map")).status).toBe("sent"); });
    const callback = new URL(h.callbackUrl);
    if (withReferral) expect(callback.searchParams.get("_referralSignupProof")).toBe("trusted-referral-proof");
    const landing = new URL("/map", window.location.origin);
    landing.searchParams.set("_authCallback", "1");
    landing.searchParams.set("_authAttempt", callback.searchParams.get("_authAttempt")!);
    if (withReferral) landing.searchParams.set("_referralSignupProof", callback.searchParams.get("_referralSignupProof")!);
    landing.hash = new URLSearchParams({ access_token: a.access_token, refresh_token: a.refresh_token }).toString();
    await act(async () => root.unmount());
    window.history.replaceState(null, "", landing);
    root = createRoot(container);
    await act(async () => root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe))));
    expect(h.setSession).toHaveBeenCalledOnce();
  }

  it.each(["switch", "return", "refresh"] as const)("settles legacy referral parsing under the captured account generation after %s", async (transition) => {
    const assign = captureFullNavigation();
    const transport = fetch;
    let release!: () => void;
    let parsing = false;
    let aReads = 0;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname;
      if (path === "/api/referrals/claim-attribution") {
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${a.access_token}`);
        const response = Response.json({ inviterHandle: "friend" });
        response.json = async () => { parsing = true; await delayed; return { inviterHandle: "friend" }; };
        return response;
      }
      if (path === "/api/identity/handle/current") {
        const bearer = new Headers(init?.headers).get("authorization");
        return Response.json({ handle: bearer === `Bearer ${a.access_token}` ? (++aReads === 1 ? "alice" : "alice_new") : "bob" });
      }
      return transport(input, init);
    });
    await mountLegacyCallback();
    await vi.waitFor(() => expect(parsing).toBe(true));
    await act(async () => {
      if (transition === "refresh") h.subscriber?.("TOKEN_REFRESHED", a);
      else {
        h.session = b; h.subscriber?.("SIGNED_IN", b);
        if (transition === "return") { h.session = a; h.subscriber?.("SIGNED_IN", a); }
      }
    });
    const handle = transition === "switch" ? "bob" : transition === "return" ? "alice_new" : "alice";
    const owner = transition === "switch" ? "original" : "replacement";
    await vi.waitFor(() => expect(actions.handle).toBe(handle));
    const records = readDeviceAccounts(localStorage);
    await act(async () => { release(); });
    expect(actions.user?.id).toBe(owner);
    expect(actions.handle).toBe(handle);
    expect(localStorage.getItem("pubmax_account_owner")).toBe(owner);
    expect(localStorage.getItem("pubmax_handle")).toBe(handle);
    expect(readDeviceAccounts(localStorage)).toEqual(records);
    expect(sessionStorage.getItem("pubmax:referral-follow-handle")).toBe(transition === "refresh" ? "friend" : null);
    expect(assign).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it.each(["switch", "return"] as const)("does not publish a legacy identity or destination after %s during response parsing", async (transition) => {
    const assign = captureFullNavigation();
    const transport = fetch;
    let release!: () => void;
    let oldReads = 0;
    let oldGeneration = true;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), window.location.href).pathname !== "/api/identity/handle/current") return transport(input, init);
      const bearer = new Headers(init?.headers).get("authorization");
      if (bearer !== `Bearer ${a.access_token}`) return Response.json({ handle: "bob" });
      if (!oldGeneration) return Response.json({ handle: "alice_new" });
      oldReads += 1;
      const response = Response.json({});
      response.json = async () => { await delayed; return { handle: transition === "switch" ? null : "alice_old" }; };
      return response;
    });
    await mountLegacyCallback(false);
    expect(oldReads).toBe(2);
    await act(async () => {
      oldGeneration = false;
      h.session = b; h.subscriber?.("SIGNED_IN", b);
      if (transition === "return") { h.session = a; h.subscriber?.("SIGNED_IN", a); }
    });
    const handle = transition === "switch" ? "bob" : "alice_new";
    const owner = transition === "switch" ? "original" : "replacement";
    await vi.waitFor(() => expect(actions.handle).toBe(handle));
    const records = readDeviceAccounts(localStorage);
    await act(async () => { release(); });
    expect(actions.user?.id).toBe(owner);
    expect(actions.handle).toBe(handle);
    expect(actions.identityResolved).toBe(true);
    expect(localStorage.getItem("pubmax_account_owner")).toBe(owner);
    expect(localStorage.getItem("pubmax_handle")).toBe(handle);
    expect(readDeviceAccounts(localStorage)).toEqual(records);
    expect(sessionStorage.getItem("pubmax:referral-follow-handle")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("does not retry a legacy referral after returning to A during backoff", async () => {
    const assign = captureFullNavigation();
    const transport = fetch;
    let claims = 0;
    let aReads = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname;
      if (path === "/api/referrals/claim-attribution") {
        claims += 1;
        return new Response(null, { status: 503, headers: { "retry-after": "0.02" } });
      }
      if (path === "/api/identity/handle/current") {
        const bearer = new Headers(init?.headers).get("authorization");
        return Response.json({ handle: bearer === `Bearer ${a.access_token}` ? (++aReads === 1 ? "alice" : "alice_new") : "bob" });
      }
      return transport(input, init);
    });
    await mountLegacyCallback();
    await vi.waitFor(() => expect(claims).toBe(1));
    await act(async () => {
      h.session = b; h.subscriber?.("SIGNED_IN", b);
      h.session = a; h.subscriber?.("SIGNED_IN", a);
    });
    await vi.waitFor(() => expect(actions.handle).toBe("alice_new"));
    const records = readDeviceAccounts(localStorage);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(claims).toBe(1);
    expect(localStorage.getItem("pubmax_handle")).toBe("alice_new");
    expect(readDeviceAccounts(localStorage)).toEqual(records);
    expect(sessionStorage.getItem("pubmax:referral-follow-handle")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it("makes a fresh canonical read for a synchronous A-B-A generation", async () => {
    h.realIdentity = true;
    const transport = fetch;
    let release!: () => void;
    let aReads = 0;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), window.location.href).pathname !== "/api/identity/handle/current") {
        return transport(input, init);
      }
      const bearer = new Headers(init?.headers).get("authorization");
      if (bearer !== `Bearer ${a.access_token}`) return Response.json({ handle: "bob" });
      if (++aReads !== 1) return Response.json({ handle: "alice_new" });
      const response = Response.json({ handle: "alice_old" });
      response.json = async () => { await delayed; return { handle: "alice_old" }; };
      return response;
    });
    await act(async () => { h.session = a; h.subscriber?.("SIGNED_IN", a); });
    expect(aReads).toBe(1);
    try {
      await act(async () => {
        h.session = b; h.subscriber?.("SIGNED_IN", b);
        h.session = a; h.subscriber?.("SIGNED_IN", a);
      });
      await vi.waitFor(() => expect(aReads).toBe(2));
      await vi.waitFor(() => expect(actions.handle).toBe("alice_new"));
    } finally {
      await act(async () => { release(); });
    }
    expect(actions.user?.id).toBe("replacement");
    expect(actions.handle).toBe("alice_new");
    expect(actions.identityResolved).toBe(true);
    expect(localStorage.getItem("pubmax_account_owner")).toBe("replacement");
    expect(localStorage.getItem("pubmax_handle")).toBe("alice_new");
    expect(readDeviceAccounts(localStorage).find((record) => record.userId === "replacement")?.handle).toBe("alice_new");
    expect(sessionStorage.getItem("pubmax:referral-follow-handle")).toBeNull();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe("mounted native cancellation with the installed canonical SDK", () => {
  it("cancels email and provider installations during remote verification without changing original device data", async () => {
    const actual = await vi.importActual<typeof import("@/lib/authClient")>("@/lib/authClient");
    let release!: () => void;
    let delay: Promise<void> | null = null;
    let verifying = false;
    let nativeUserReads = 0;
    let expectedRead = 2;
    const restoredAccess = `e30.${Buffer.from(JSON.stringify({ sub: "original", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.unsigned`;
    const transport = globalThis.fetch;
    const requests = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href);
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
        return Response.json({ code: "refresh_token_not_found", message: "Refresh token does not exist" }, { status: 400 });
      }
      if (url.pathname === "/auth/v1/user" && new Headers(init?.headers).get("authorization") === `Bearer ${restoredAccess}`) return Response.json(original.user);
      if (url.pathname === "/auth/v1/user") {
        nativeUserReads += 1;
        if (nativeUserReads === expectedRead && delay) { verifying = true; await delay; }
      }
      return transport(input, init);
    });
    vi.stubGlobal("fetch", requests);
    await act(async () => root.unmount());
    h.realAuth = await actual.ensureSupabaseBrowser();
    expect(h.realAuth).not.toBeNull();
    root = createRoot(container);
    await act(async () => root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe))));
    const { rememberDeviceAccount, readDeviceAccounts } = await import("@/lib/deviceAccountSessions");
    const originalLastActiveAt = 1_700_000_000_000;
    rememberDeviceAccount(localStorage, { userId: "original", refreshToken: "original-refresh", handle: "original_owner" }, originalLastActiveAt);
    localStorage.setItem("pubmax_handle", "original_owner");
    localStorage.setItem("pubmax_account_owner", "original");
    const originalRecords = readDeviceAccounts(localStorage);
    expect(originalRecords).toMatchObject([{
      userId: "original",
      refreshToken: "original-refresh",
      handle: "original_owner",
      lastActiveAt: originalLastActiveAt,
    }]);
    for (const method of ["email", "google", "apple", "microsoft"] as const) {
      nativeUserReads = 0; expectedRead = method === "email" ? 2 : 1; verifying = false;
      delay = new Promise<void>((resolve) => { release = resolve; });
      let pending: Promise<unknown> | null = null;
      await act(async () => {
        if (method === "email") {
          await actions.signInWithEmail("native@example.test");
          for (const listener of h.listeners) listener({ url: await emailCallback() });
        } else {
          pending = method === "google" ? actions.signInWithGoogle() : method === "apple" ? actions.signInWithApple() : actions.signInWithMicrosoft();
        }
      });
      await vi.waitFor(() => expect(verifying).toBe(true));
      await act(async () => actions.cancelAuthAttempt());
      await act(async () => { release(); if (pending) await pending; });
      await vi.waitFor(async () => expect((await h.realAuth!.auth.getSession()).data.session).toBeNull());
      expect(container.querySelector("output")?.textContent).toBe("signed-out");
      expect(readDeviceAccounts(localStorage)).toEqual(originalRecords);
      expect(localStorage.getItem("pubmax_handle")).toBe("original_owner");
      expect(h.persist).not.toHaveBeenCalled();
      expect(h.referralBodies).toEqual([]);
      expect(h.navigate).not.toHaveBeenCalled();
      expect(requests.mock.calls.some(([input]) => String(input).includes("/logout"))).toBe(false);
    }
    delay = null;
    let releaseCleanup!: () => void;
    let cleanupStarted = false;
    h.stopAutoRefresh.mockImplementation(() => {
      cleanupStarted = true;
      return new Promise<void>((resolve) => { releaseCleanup = resolve; });
    });
    let providerCompletion!: Promise<unknown>;
    await act(async () => { providerCompletion = actions.signInWithGoogle(); });
    await vi.waitFor(() => expect(cleanupStarted).toBe(true));
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    await act(async () => actions.cancelAuthAttempt());
    expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
    await act(async () => { releaseCleanup(); await providerCompletion; });
    expect(readDeviceAccounts(localStorage)).toEqual(originalRecords);
    h.stopAutoRefresh.mockResolvedValue(undefined);
    let cancelAfterWrite = true;
    let cancelledAfterWrite = false;
    const registration = h.realAuth!.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" && cancelAfterWrite) { cancelledAfterWrite = true; actions.cancelAuthAttempt(); }
    });
    await act(async () => { await actions.signInWithEmail("native@example.test"); });
    await openApp(await emailCallback());
    await vi.waitFor(() => expect(cancelledAfterWrite).toBe(true));
    await vi.waitFor(async () => expect((await h.realAuth!.auth.getSession()).data.session).toBeNull());
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    expect(readDeviceAccounts(localStorage)).toEqual(originalRecords);
    expect(localStorage.getItem("pubmax_handle")).toBe("original_owner");
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
    cancelAfterWrite = false;
    nativeUserReads = 0; expectedRead = 1; verifying = false;
    delay = new Promise<void>((resolve) => { release = resolve; });
    let conflicted!: Promise<unknown>;
    await act(async () => { conflicted = actions.signInWithGoogle(); });
    await vi.waitFor(() => expect(verifying).toBe(true));
    await act(async () => { await h.realAuth!.auth.setSession({ access_token: restoredAccess, refresh_token: "original-refresh" }); });
    expect(container.querySelector("output")?.textContent).toBe("original");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_601_000);
    await act(async () => { await h.realAuth!.auth.refreshSession(); });
    clock.mockRestore();
    expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    await act(async () => { release(); await conflicted; });
    expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
    delay = null;
    await act(async () => { await actions.signInWithEmail("native@example.test", "/u/you"); });
    await openApp(await emailCallback());
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"));
    expect((await h.realAuth!.auth.getSession()).data.session?.user.id).toBe("replacement");
    expect(h.navigate).toHaveBeenCalledWith("/u/you");
    expect(readDeviceAccounts(localStorage).map((account) => account.userId)).toContain("original");
    expect(requests.mock.calls.some(([input]) => String(input).includes("/logout"))).toBe(false);
    registration.data.subscription.unsubscribe();
    await h.realAuth!.auth.stopAutoRefresh();
  });
});
