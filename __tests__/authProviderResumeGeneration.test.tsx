// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What runs for real: AuthProvider's auth-event handling and sign-out, the
// browser resume client, the /api/auth/session route handlers and the social
// cookie reader. Explicit doubles: the Supabase browser client (events are
// emitted in the order the installed SDK uses, pinned in
// __tests__/authSessionTransition.test.ts), the bearer verifier, rate limiting,
// a GoTrue that never revokes, and a browser-like cookie jar. Not real GoTrue
// revocation and not a compiled-browser run.

const harness = vi.hoisted(() => ({
  emit: null as null | ((event: string, session: unknown) => void),
  holdPersist: false,
  releasePersist: [] as Array<() => void>,
  trackEvent: vi.fn(),
}));

vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: harness.trackEvent }));
vi.mock("@/lib/posthog/posthogPerson", () => ({ syncPosthogPersonIdentity: vi.fn() }));
vi.mock("@/lib/authClient", () => ({
  isAuthConfigured: () => true,
  getAccessToken: async () => null,
  ensureSupabaseBrowser: async () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        harness.emit = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => {
        harness.emit?.("SIGNED_OUT", null);
        return { error: null };
      },
    },
  }),
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: false, apple: false, microsoft: false }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax-auth-return-fragment-restored",
  scrubAuthCallback: async () => null,
  scrubLingeringAuthCallback: vi.fn(() => false),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: async () => ({ status: "none" }),
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
import { rememberDeliberateSignIn } from "@/lib/authSessionResumeClient";
import { resolveSocialAccess } from "@/lib/socialAccessServer";

const SUPABASE_URL = "https://auth-generation.invalid";
const A = "account-a";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionFor(id: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({ sub: id, exp })}.${base64Url("signature")}`,
    refresh_token: `synthetic-refresh-${id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id, email: `${id}@example.com`, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00.000Z" },
  };
}

let httpOnlyCookies: Map<string, string>;
let auth: ReturnType<typeof useAuth> | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

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

async function sessionRoute(init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookieHeader());
  headers.set("sec-fetch-site", "same-origin");
  const request = new Request("http://localhost/api/auth/session", { ...init, headers });
  const response = request.method === "GET" ? await GET(request) : request.method === "DELETE" ? await DELETE(request) : await POST(request);
  if (harness.holdPersist && request.method === "POST") {
    return new Promise<Response>((resolve) => {
      harness.releasePersist.push(() => {
        applySetCookies(response);
        resolve(response);
      });
    });
  }
  applySetCookies(response);
  return response;
}

async function hintPresent(): Promise<boolean> {
  const body = await (await GET(new Request("http://localhost/api/auth/session", { headers: { cookie: cookieHeader() } }))).json() as { hint: unknown };
  return body.hint !== null;
}

async function cookieReaderState() {
  return (await resolveSocialAccess(new Request("http://localhost/api/social/access", { headers: { cookie: cookieHeader() } }))).state;
}

function Probe() {
  const current = useAuth();
  useEffect(() => { auth = current; });
  return createElement("output", { "data-testid": "viewer" }, current.user?.id ?? "signed-out");
}

async function emit(event: string, session: unknown) {
  await act(async () => { harness.emit?.(event, session); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(async () => {
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
  harness.holdPersist = false;
  harness.releasePersist = [];
  harness.trackEvent.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "/api/auth/session") return sessionRoute(init);
    if (url.includes("/auth/v1/token")) {
      const refresh = (JSON.parse(String(init?.body)) as { refresh_token: string }).refresh_token;
      return new Response(JSON.stringify(sessionFor(refresh.replace("synthetic-refresh-", ""))), { status: 200 });
    }
    return new Response("{}");
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe)));
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const { __resetPintDrops } = await import("@/lib/pintDrops");
  __resetPintDrops();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

/** A sign-in the person asked for: the SDK signs in, then the app remembers that account. */
async function deliberateSignIn(id = A) {
  await emit("INITIAL_SESSION", null);
  await emit("SIGNED_IN", sessionFor(id));
  await act(async () => { await rememberDeliberateSignIn(sessionFor(id)); });
  await vi.waitFor(async () => expect(await hintPresent()).toBe(true));
}

describe("resume generations come only from sign-ins the person asked for", () => {
  it("does not let another tab's SIGNED_IN after an explicit sign-out remember the account again", async () => {
    await deliberateSignIn();
    await act(async () => auth?.signOut());
    expect(await hintPresent()).toBe(false);

    await emit("SIGNED_IN", sessionFor(A));
    expect(await hintPresent()).toBe(false);
    expect(await cookieReaderState()).toBe("sign_in_required");
  });

  it("does not let a cold-boot persist that lands after an explicit sign-out remember the account", async () => {
    await rememberDeliberateSignIn(sessionFor(A));
    harness.holdPersist = true;
    // The installed SDK replays a stored session as SIGNED_IN before INITIAL_SESSION.
    await emit("SIGNED_IN", sessionFor(A));
    await emit("INITIAL_SESSION", sessionFor(A));
    await vi.waitFor(() => expect(harness.releasePersist.length).toBeGreaterThan(0));
    harness.holdPersist = false;
    await act(async () => auth?.signOut());
    await act(async () => { for (const release of harness.releasePersist) release(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(await hintPresent()).toBe(false);
    expect(await cookieReaderState()).toBe("sign_in_required");
  });

  it("reports a sign-in only for a SIGNED_IN after INITIAL_SESSION, not for a cold boot", async () => {
    await emit("SIGNED_IN", sessionFor(A));
    await emit("INITIAL_SESSION", sessionFor(A));
    expect(harness.trackEvent).not.toHaveBeenCalledWith("user_signed_in");
  });

  it("keeps durable resume for a deliberate sign-in and its background refreshes", async () => {
    await deliberateSignIn();
    expect(harness.trackEvent).toHaveBeenCalledWith("user_signed_in");
    await emit("TOKEN_REFRESHED", sessionFor(A));
    expect(await hintPresent()).toBe(true);
  });

  it("does not remember an older account's session that the SDK adopts after another account's sign-in", async () => {
    await deliberateSignIn(A);
    await act(async () => auth?.signOut());
    await deliberateSignIn("account-b");
    // A's setSession finishes late and the SDK emits its SIGNED_IN.
    await emit("SIGNED_IN", sessionFor(A));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    const reader = await resolveSocialAccess(new Request("http://localhost/api/social/access", { headers: { cookie: cookieHeader() } }));
    expect(reader.state).not.toBe("sign_in_required");
    const redeemed = await (await POST(new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { cookie: cookieHeader(), "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ action: "redeem" }),
    }))).json() as { session?: { refresh_token?: string } };
    expect(redeemed.session?.refresh_token).toBe("synthetic-refresh-account-b");
  });
});

