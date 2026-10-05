// @vitest-environment jsdom
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What runs for real: AuthProvider, the installed Supabase client (2.117 runs
// auth calls without a lock by default, so a sign-out's late removal can land
// after another sign-in's install), bootstrapAuthSession, the auth callback
// client, the browser resume client and the /api/auth/session route handlers.
// Explicit doubles: an in-memory GoTrue that never revokes, the bearer
// verifier, rate limiting, the callback capture and a browser-like cookie jar.
// One document only: not cross-tab ordering, not real GoTrue revocation and
// not a compiled-browser run.

const harness = vi.hoisted(() => ({
  clientReady: null as null | Promise<unknown>,
  captured: null as unknown,
}));

vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/posthog/posthogPerson", () => ({ syncPosthogPersonIdentity: vi.fn() }));
vi.mock("@/lib/authClient", () => ({
  isAuthConfigured: () => true,
  getAccessToken: async () => null,
  ensureSupabaseBrowser: () => harness.clientReady,
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: false, apple: false, microsoft: false }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax-auth-return-fragment-restored",
  scrubAuthCallback: async () => harness.captured,
  scrubLingeringAuthCallback: vi.fn(() => false),
}));
vi.mock("@/lib/identityClient", () => ({
  handleClaimRouteAfterSignIn: async () => null,
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => null,
}));
vi.mock("@/lib/referralClaimClient", () => ({
  claimSignupReferralFromAuthCallback: async () => {},
  withReferralSignupProof: (attempt: unknown) => attempt,
}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => false,
  checkRateLimitDurableDetailed: async () => ({ verdict: null, reason: "no-client" }) as const,
}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {}, assertProductionSecrets: () => {} }));
vi.mock("@/lib/authServer", () => ({
  verifyCallerAuth: async (request: Request) => {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!bearer) return { status: "absent" };
    const sub = JSON.parse(Buffer.from(bearer.split(".")[1] ?? "", "base64url").toString()).sub as string;
    return { status: "verified", identity: { id: sub, email: `${sub}@example.com`, createdAt: null } };
  },
}));

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { DELETE, GET, POST } from "@/app/api/auth/session/route";
import { establishAuthCallbackSession } from "@/lib/authCallbackClient";
import {
  commitSignIn,
  persistSessionForResume,
  readResumeGeneration,
  sessionAccountAdmitted,
} from "@/lib/authSessionResumeClient";
import { deviceAccountOwner } from "@/lib/deviceAccountIdentity";

const SUPABASE_URL = "https://auth-superseded.invalid";
const SDK_STORAGE_KEY = "pubmax-superseded-auth-token";
const A = "account-a";
const B = "account-b";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionFor(id: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({ sub: id, exp, role: "authenticated" })}.${base64Url("signature")}`,
    refresh_token: `synthetic-refresh-${id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id, email: `${id}@example.com`, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00.000Z" },
  };
}

function subject(token: string): string {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()).sub as string;
}

let httpOnlyCookies: Map<string, string>;
let sdkItems: Map<string, string>;
let holdLogout: boolean;
let releaseLogout: (() => void) | null;
let auth: ReturnType<typeof useAuth> | null;
let root: Root | null;
let container: HTMLDivElement | null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function cookieHeader(): string {
  return [document.cookie, ...[...httpOnlyCookies].map(([name, value]) => `${name}=${value}`)].filter(Boolean).join("; ");
}

function applySetCookies(response: Response): void {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(";")[0] ?? "";
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    if (/;\s*httponly/i.test(raw)) {
      if (/max-age=0/i.test(raw) || value === "") httpOnlyCookies.delete(name);
      else httpOnlyCookies.set(name, value);
    } else {
      document.cookie = raw.replace(/;\s*secure/i, "");
    }
  }
}

async function sessionRoute(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookieHeader());
  headers.set("sec-fetch-site", "same-origin");
  const request = new Request(`http://localhost${url}`, { ...init, headers });
  const response = request.method === "GET" ? await GET(request) : request.method === "DELETE" ? await DELETE(request) : await POST(request);
  applySetCookies(response);
  return response;
}

async function transport(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("/api/auth/session")) return sessionRoute(url, init);
  if (url.includes("/auth/v1/token")) {
    const refresh = (JSON.parse(String(init.body)) as { refresh_token: string }).refresh_token;
    return json(sessionFor(refresh.replace("synthetic-refresh-", "")));
  }
  if (url.includes("/auth/v1/user")) {
    const bearer = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
    return json(sessionFor(subject(bearer)).user);
  }
  if (url.includes("/auth/v1/logout")) {
    if (holdLogout) await new Promise<void>((resolve) => { releaseLogout = resolve; });
    return new Response(null, { status: 204 });
  }
  return json({});
}

function makeClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "synthetic-public-key", {
    auth: {
      storageKey: SDK_STORAGE_KEY,
      storage: {
        getItem: (key) => sdkItems.get(key) ?? null,
        setItem: (key, value) => { sdkItems.set(key, value); },
        removeItem: (key) => { sdkItems.delete(key); },
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: transport },
  });
}

function Probe() {
  const current = useAuth();
  useEffect(() => { auth = current; });
  return createElement("output", { "data-testid": "viewer" }, current.user?.id ?? "signed-out");
}

function viewer(): string | null | undefined {
  return container?.querySelector('[data-testid="viewer"]')?.textContent;
}

function storedSdkAccount(): string | null {
  const raw = sdkItems.get(SDK_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { user: { id: string } }).user.id : null;
}

async function redeemedAccount(): Promise<string | null> {
  const body = await (await POST(new Request("http://localhost/api/auth/session", {
    method: "POST",
    headers: { cookie: cookieHeader(), "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ action: "redeem" }),
  }))).json() as { session?: { refresh_token?: string } };
  return body.session?.refresh_token?.replace("synthetic-refresh-", "") ?? null;
}

/** A deliberate sign-in another document already finished: generation, shared SDK storage and cookie. */
async function signedInElsewhere(id: string) {
  expect(commitSignIn(readResumeGeneration(), sessionFor(id).access_token)).not.toBeNull();
  sdkItems.set(SDK_STORAGE_KEY, JSON.stringify(sessionFor(id)));
  expect(await persistSessionForResume(sessionFor(id))).toBe("stored");
}

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe)));
  });
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
  localStorage.clear();
  sessionStorage.clear();
  httpOnlyCookies = new Map();
  sdkItems = new Map();
  holdLogout = false;
  releaseLogout = null;
  auth = null;
  root = null;
  container = null;
  harness.captured = null;
  harness.clientReady = null;
  vi.stubGlobal("fetch", vi.fn(transport));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const { __resetPintDrops } = await import("@/lib/pintDrops");
  __resetPintDrops();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

describe("a sign-in the person asked for owns the device over older auth work", () => {
  it.each(["account", "device"] as const)("keeps a sign-in that commits while an explicit %s sign-out still waits on the provider", async (scope) => {
    await signedInElsewhere(A);
    const client = makeClient();
    harness.clientReady = Promise.resolve(client);
    await mount();
    await vi.waitFor(() => expect(viewer()).toBe(A));

    holdLogout = true;
    let signingOut: Promise<void> = Promise.resolve();
    await act(async () => { signingOut = auth!.signOut(scope); });
    await vi.waitFor(() => expect(releaseLogout).not.toBeNull());
    // B signs in from this document. The installed client has no auth lock, so
    // its install can finish before the sign-out's removal does.
    const signingIn = establishAuthCallbackSession(client.auth, {
      accessToken: sessionFor(B).access_token,
      refreshToken: sessionFor(B).refresh_token,
    });
    const bGeneration = readResumeGeneration();
    await act(async () => {
      releaseLogout!();
      await signingOut;
      await signingIn;
    });
    await settle();

    expect(bGeneration).toMatch(new RegExp(`~${B}$`));
    expect(readResumeGeneration()).toBe(bGeneration);
    expect(storedSdkAccount()).toBe(B);
    await vi.waitFor(() => expect(viewer()).toBe(B));
    expect(auth?.session?.user.id).toBe(B);
    expect(sessionAccountAdmitted(B)).toBe(true);
    expect(deviceAccountOwner(localStorage)).toBe(B);
    await vi.waitFor(async () => expect(await redeemedAccount()).toBe(B));
  });

  it("restores the remembered account when the SDK still holds an older account's session", async () => {
    await signedInElsewhere(A);
    const staleA = sdkItems.get(SDK_STORAGE_KEY)!;
    await signedInElsewhere(B);
    // This browser's SDK storage still carries A (a write the other document's sign-in never replaced).
    sdkItems.set(SDK_STORAGE_KEY, staleA);
    harness.clientReady = Promise.resolve(makeClient());
    await mount();

    await vi.waitFor(() => expect(viewer()).toBe(B));
    expect(auth?.session?.user.id).toBe(B);
    expect(storedSdkAccount()).toBe(B);
    expect(readResumeGeneration()).toMatch(new RegExp(`~${B}$`));
    expect(await redeemedAccount()).toBe(B);
  });

  it("does not install an owned callback over a sign-in that committed while the SDK was downloading", async () => {
    document.cookie = "pubmax_resume_gen=g0; Path=/";
    harness.captured = {
      attempt: {
        attemptId: null,
        tokens: { accessToken: sessionFor(A).access_token, refreshToken: sessionFor(A).refresh_token },
        providerError: false,
      },
      cleanUrl: "/map",
      localAttemptOwned: true,
      releaseCoordination: () => {},
    };
    let finishDownload = () => {};
    harness.clientReady = new Promise((resolve) => { finishDownload = () => resolve(makeClient()); });
    await mount();

    await signedInElsewhere(B);
    await act(async () => { finishDownload(); });
    await settle();

    await vi.waitFor(() => expect(viewer()).toBe(B));
    expect(readResumeGeneration()).toMatch(new RegExp(`~${B}$`));
    expect(storedSdkAccount()).toBe(B);
    expect(auth?.session?.user.id).toBe(B);
    expect(await redeemedAccount()).toBe(B);
  });

  it("still installs an owned callback when nothing else signed in meanwhile", async () => {
    harness.captured = {
      attempt: {
        attemptId: null,
        tokens: { accessToken: sessionFor(A).access_token, refreshToken: sessionFor(A).refresh_token },
        providerError: false,
      },
      cleanUrl: "/map",
      localAttemptOwned: true,
      releaseCoordination: () => {},
    };
    let finishDownload = () => {};
    harness.clientReady = new Promise((resolve) => { finishDownload = () => resolve(makeClient()); });
    await mount();
    await act(async () => { finishDownload(); });

    await vi.waitFor(() => expect(viewer()).toBe(A));
    expect(readResumeGeneration()).toMatch(new RegExp(`~${A}$`));
    expect(storedSdkAccount()).toBe(A);
    await vi.waitFor(async () => expect(await redeemedAccount()).toBe(A));
  });
});
