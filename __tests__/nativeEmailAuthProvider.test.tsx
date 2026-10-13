// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://pubmaxxing.com"}
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/components/auth/authContext";

const h = vi.hoisted(() => ({
  platform: "ios" as "ios" | "android" | null,
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
vi.mock("@/lib/nativeAuthClient", () => ({ createNativeAuthClient: async () => ({ auth: {
  signInWithOAuth: h.nativeOAuth, exchangeCodeForSession: h.exchange, getUser: h.verify, stopAutoRefresh: async () => {},
} }) }));
vi.mock("@/lib/nativeAuthSession", async (original) => ({
  ...await original<typeof import("@/lib/nativeAuthSession")>(),
  nativeAuthSessionAvailable: async () => h.available,
  authenticateNativeSession: h.authenticate,
  cancelNativeAuthSession: h.cancel,
}));
vi.mock("@/lib/authClient", () => ({
  isAuthConfigured: () => true,
  getAccessToken: async () => h.session?.access_token ?? null,
  ensureSupabaseBrowser: async () => ({ auth: {
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
vi.mock("@/lib/identityClient", async (original) => ({
  ...await original<typeof import("@/lib/identityClient")>(),
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => ({ ok: true, identity: null }),
}));
vi.mock("@/lib/authSessionResumeClient", async (original) => ({
  ...await original<typeof import("@/lib/authSessionResumeClient")>(),
  clearPersistedSession: async () => {}, persistSessionForResume: async () => "stored", markResumePersisted: () => {},
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
  h.platform = "ios"; h.session = null; h.available = true;
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
