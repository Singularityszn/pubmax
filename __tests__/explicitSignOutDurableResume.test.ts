// @vitest-environment jsdom
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What runs for real: the installed Supabase client, bootstrapAuthSession, the
// browser resume client, the /api/auth/session route handlers and the social
// cookie-authenticated reader. The doubles are explicit: an in-memory GoTrue
// that never revokes a token (the logout that failed offline), the bearer
// verifier, rate limiting, and a cookie jar that applies Set-Cookie the way a
// browser does - HttpOnly cookies in a map, script-visible ones in jsdom's
// document.cookie. This is device-side restore proof, not real GoTrue
// revocation and not a compiled-browser run.

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
    const account = [A, B].find((candidate) => candidate.id === sub);
    return account
      ? { status: "verified", identity: { id: account.id, email: account.email, createdAt: null } }
      : { status: "invalid" };
  },
}));

import { DELETE, GET, POST } from "@/app/api/auth/session/route";
import { bootstrapAuthSession } from "@/lib/authSessionBootstrap";
import { clearPersistedSession, persistSessionForResume, rememberDeliberateSignIn } from "@/lib/authSessionResumeClient";
import { resolveSocialAccess } from "@/lib/socialAccessServer";

type Account = { id: string; email: string };
const A: Account = { id: "account-a", email: "a@example.com" };
const B: Account = { id: "account-b", email: "b@example.com" };
const SUPABASE_URL = "https://auth-journey.invalid";
const SDK_STORAGE_KEY = "pubmax-resume-journey-auth-token";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionFor(account: Account) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({ sub: account.id, exp: expiresAt, role: "authenticated" })}.${base64Url("signature")}`,
    refresh_token: `synthetic-refresh-${account.id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: {
      id: account.id, aud: "authenticated", role: "authenticated", email: account.email,
      app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

let online: boolean;
let deleteReachesServer: boolean;
let httpOnlyCookies: Map<string, string>;
let sdkItems: Map<string, string>;
let tokenGrants: string[];
let holdRedeem: boolean;
let releaseRedeem: (() => void) | null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function cookieHeader(): string {
  return [document.cookie, ...[...httpOnlyCookies].map(([name, value]) => `${name}=${value}`)]
    .filter(Boolean)
    .join("; ");
}

function applySetCookies(response: Response): void {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(";")[0] ?? "";
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    const expired = /max-age=0/i.test(raw) || value === "";
    if (/;\s*httponly/i.test(raw)) {
      if (expired) httpOnlyCookies.delete(name);
      else httpOnlyCookies.set(name, value);
    } else {
      document.cookie = raw.replace(/;\s*secure/i, "");
    }
  }
}

function sessionRequest(init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookieHeader());
  headers.set("sec-fetch-site", "same-origin");
  return new Request("http://localhost/api/auth/session", { ...init, headers });
}

async function sessionRoute(request: Request): Promise<Response> {
  const method = request.method;
  const response = method === "GET" ? await GET(request) : method === "DELETE" ? await DELETE(request) : await POST(request);
  applySetCookies(response);
  return response;
}

async function gotrue(url: string, init: RequestInit = {}): Promise<Response> {
  if (url.includes("/auth/v1/token")) {
    const refresh = (JSON.parse(String(init.body)) as { refresh_token: string }).refresh_token;
    tokenGrants.push(refresh);
    const account = [A, B].find((candidate) => refresh === `synthetic-refresh-${candidate.id}`);
    return account ? json(sessionFor(account)) : json({ error_code: "refresh_token_not_found" }, 400);
  }
  if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
  if (url.includes("/auth/v1/user")) {
    return json(sessionFor(A).user);
  }
  throw new Error(`Unexpected synthetic provider request: ${url}`);
}

function makeClient() {
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
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!online) throw new TypeError("Failed to fetch");
        return gotrue(String(input instanceof Request ? input.url : input), init);
      },
    },
  });
}

/** A deliberate sign-in as the app completes it: local SDK session, then remembered for that account. */
async function signIn(account: Account) {
  sdkItems.set(SDK_STORAGE_KEY, JSON.stringify(sessionFor(account)));
  expect(await rememberDeliberateSignIn(sessionFor(account))).toBe("stored");
  return makeClient();
}

/** The two device steps AuthProvider.signOut awaits after the SDK sign-out, in its order. */
async function explicitSignOut(client: ReturnType<typeof makeClient>) {
  await client.auth.signOut();
  await clearPersistedSession();
}

async function reload() {
  const client = makeClient();
  const outcome = await bootstrapAuthSession(client.auth);
  return { client, outcome };
}

async function cookieReader() {
  return resolveSocialAccess(new Request("http://localhost/api/social/access", { headers: { cookie: cookieHeader() } }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
  localStorage.clear();
  online = true;
  deleteReachesServer = true;
  httpOnlyCookies = new Map();
  sdkItems = new Map();
  tokenGrants = [];
  holdRedeem = false;
  releaseRedeem = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "/api/auth/session") {
      if (!online) throw new TypeError("Failed to fetch");
      if (init?.method === "DELETE" && !deleteReachesServer) return json({ error: "synthetic outage" }, 503);
      if (holdRedeem && String(init?.body).includes('"redeem"')) {
        const answered = await POST(sessionRequest(init));
        return new Promise<Response>((resolve) => {
          releaseRedeem = () => {
            applySetCookies(answered);
            resolve(answered);
          };
        });
      }
      return sessionRoute(sessionRequest(init));
    }
    return gotrue(url, init);
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  const { __resetPintDrops } = await import("@/lib/pintDrops");
  __resetPintDrops();
});

describe("explicit sign-out against the durable resume cookie", () => {
  it.each([
    ["the device is offline", () => { online = false; }],
    ["the cookie DELETE answers 503", () => { deleteReachesServer = false; }],
  ])("keeps the departed account signed out after reconnecting when %s", async (_label, fail) => {
    const client = await signIn(A);
    fail();
    await explicitSignOut(client);
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(httpOnlyCookies.size).toBe(1);

    online = true;
    deleteReachesServer = true;
    const { client: reloaded, outcome } = await reload();
    expect(outcome.status).toBe("none");
    expect((await reloaded.auth.getSession()).data.session).toBeNull();
    expect(tokenGrants).toEqual([]);
    expect((await cookieReader()).state).toBe("sign_in_required");
    expect(tokenGrants).toEqual([]);
  });

  it("stops the cookie authenticating server readers as soon as the device reconnects, before any boot", async () => {
    const client = await signIn(A);
    online = false;
    await explicitSignOut(client);
    online = true;
    expect((await cookieReader()).state).toBe("sign_in_required");
    expect(tokenGrants).toEqual([]);
  });

  it("holds the fence when browser storage is unavailable", async () => {
    const client = await signIn(A);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    online = false;
    await explicitSignOut(client);
    online = true;
    const { outcome } = await reload();
    expect(outcome.status).toBe("none");
    expect(tokenGrants).toEqual([]);
  });

  it("does not count a cookie written by a pre-logout persist whose page is gone", async () => {
    const client = await signIn(A);
    const latePersist = await POST(sessionRequest({
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionFor(A).access_token}` },
      body: JSON.stringify({ action: "persist", refreshToken: sessionFor(A).refresh_token, intent: "background" }),
    }));
    await explicitSignOut(client);
    expect(httpOnlyCookies.size).toBe(0);
    applySetCookies(latePersist);
    expect(httpOnlyCookies.size).toBe(1);

    const { outcome } = await reload();
    expect(outcome.status).toBe("none");
    expect((await cookieReader()).state).toBe("sign_in_required");
    expect(tokenGrants).toEqual([]);
  });

  it("refuses a background refresh persist of the departed account after sign-out", async () => {
    const client = await signIn(A);
    await explicitSignOut(client);
    expect(await persistSessionForResume(sessionFor(A))).toBe("unavailable");
    expect(httpOnlyCookies.size).toBe(0);
    const { outcome } = await reload();
    expect(outcome.status).toBe("none");
  });

  it("remembers a deliberate new sign-in after an offline sign-out", async () => {
    const client = await signIn(A);
    online = false;
    await explicitSignOut(client);
    online = true;
    await signIn(B);
    sdkItems.clear();
    const { outcome } = await reload();
    expect(outcome).toMatchObject({ status: "restored", session: { refresh_token: `synthetic-refresh-${B.id}` } });
  });

  it("keeps durable resume across background refreshes when nobody signed out", async () => {
    await signIn(A);
    expect(await persistSessionForResume(sessionFor(A))).toBe("stored");
    sdkItems.clear();
    const { client, outcome } = await reload();
    expect(outcome).toMatchObject({ status: "restored", session: { refresh_token: `synthetic-refresh-${A.id}` } });
    expect((await client.auth.getSession()).data.session?.user.id).toBe(A.id);
    expect((await cookieReader()).state).not.toBe("sign_in_required");
  });

  it("still restores a cookie persisted before the generation fence existed", async () => {
    sdkItems.set(SDK_STORAGE_KEY, JSON.stringify(sessionFor(A)));
    expect(await persistSessionForResume(sessionFor(A))).toBe("stored");
    expect(document.cookie).toBe("");
    sdkItems.clear();
    const { outcome } = await reload();
    expect(outcome.status).toBe("restored");
  });

  it("does not let a late response to a deliberate sign-in persist replace the sign-out fence", async () => {
    const client = await signIn(A);
    // The body an earlier client sent for a deliberate sign-in, answered by the
    // server while the page that sent it navigates away.
    const late = await POST(sessionRequest({
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionFor(A).access_token}` },
      body: JSON.stringify({ action: "persist", refreshToken: sessionFor(A).refresh_token, intent: "sign-in" }),
    }));
    online = false;
    await explicitSignOut(client);
    online = true;
    applySetCookies(late);

    const { outcome } = await reload();
    expect(outcome.status).toBe("none");
    expect((await cookieReader()).state).toBe("sign_in_required");
    expect(tokenGrants).toEqual([]);
  });

  it("does not adopt an automatic redeem that lands after a sign-out in another tab", async () => {
    await signIn(A);
    sdkItems.clear();
    holdRedeem = true;
    const client = makeClient();
    const booting = bootstrapAuthSession(client.auth);
    await vi.waitFor(() => expect(releaseRedeem).not.toBeNull());
    await clearPersistedSession();
    releaseRedeem!();

    expect((await booting).status).toBe("none");
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect((await cookieReader()).state).toBe("sign_in_required");
  });

  it("keeps another account's deliberate sign-in when an older account's SDK adoption lands after it", async () => {
    const client = await signIn(A);
    await explicitSignOut(client);
    await signIn(B);
    // A's session reaches the SDK late (a delayed setSession user lookup) and
    // the provider persists it the way it persists every session event.
    expect(await persistSessionForResume(sessionFor(A))).toBe("unavailable");

    sdkItems.clear();
    const { outcome } = await reload();
    expect(outcome).toMatchObject({ status: "restored", session: { refresh_token: `synthetic-refresh-${B.id}` } });
    expect(tokenGrants.at(-1)).toBe(`synthetic-refresh-${B.id}`);
  });
});

