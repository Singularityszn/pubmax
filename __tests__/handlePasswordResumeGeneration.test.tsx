// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What runs for real: the HandlePasswordSignIn form, the browser resume
// client, and both route handlers it reaches - /api/auth/handle-password and
// /api/auth/session - behind a browser-like cookie jar. Explicit doubles: the
// Supabase browser client, the handle lookup and password grant, the bearer
// verifier, rate limiting and a GoTrue that never revokes. Not a compiled
// browser and not real provider revocation.

const harness = vi.hoisted(() => ({
  signIn: null as null | (() => Promise<unknown>),
  installs: [] as string[],
  holdHandlePassword: null as null | Promise<void>,
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ configured: true }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/authClient", () => ({
  ensureSupabaseBrowser: async () => ({
    auth: {
      setSession: async ({ access_token }: { access_token: string }) => {
        harness.installs.push(access_token);
        return { data: { session: {} }, error: null };
      },
    },
  }),
}));
vi.mock("@/lib/handlePasswordSignIn", () => ({
  resolveAuthEmailForHandle: async () => "b@example.com",
  signInWithEmailPassword: async () => harness.signIn?.() ?? null,
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pintDrops")>()),
  isLimited: async () => false,
}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => true,
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

import HandlePasswordSignIn from "@/components/auth/HandlePasswordSignIn";
import { POST as handlePassword } from "@/app/api/auth/handle-password/route";
import { DELETE, POST } from "@/app/api/auth/session/route";
import {
  clearPersistedSession,
  commitSignIn,
  persistSessionForResume,
  readResumeGeneration,
} from "@/lib/authSessionResumeClient";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionFor(id: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({ sub: id, exp })}.${base64Url("signature")}`,
    refresh_token: `synthetic-refresh-${id}`,
    expires_in: 3600,
    expires_at: exp,
    token_type: "bearer",
  };
}

let httpOnlyCookies: Map<string, string>;
let transportDown: boolean;
let root: Root;
let host: HTMLDivElement;

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

function routeRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookieHeader());
  headers.set("sec-fetch-site", "same-origin");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

/** Which account an automatic redeem would sign this device back in as, if any. */
async function redeemedAccount(): Promise<string | null> {
  const response = await POST(routeRequest("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "redeem" }),
  }));
  applySetCookies(response);
  const body = await response.json() as { session?: { refresh_token?: string } };
  return body.session?.refresh_token?.replace("synthetic-refresh-", "") ?? null;
}

async function submitPassword() {
  await act(async () => (host.querySelector('[data-testid="e2e-login-toggle"]') as HTMLButtonElement).click());
  for (const [id, value] of [["e2e-login-handle", "fixture_b"], ["e2e-login-password", "correct horse battery"]] as const) {
    const input = host.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () => (host.querySelector('[data-testid="e2e-login-submit"]') as HTMLButtonElement).click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://password-generation.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
  httpOnlyCookies = new Map();
  transportDown = false;
  harness.signIn = null;
  harness.installs = [];
  harness.holdHandlePassword = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "/api/auth/handle-password") {
      if (transportDown) throw new TypeError("Failed to fetch");
      const response = await handlePassword(routeRequest(url, init));
      if (harness.holdHandlePassword) await harness.holdHandlePassword;
      applySetCookies(response);
      return response;
    }
    if (url.startsWith("/api/auth/session")) {
      const request = routeRequest(url, init);
      const response = request.method === "DELETE" ? await DELETE(request) : await POST(request);
      applySetCookies(response);
      return response;
    }
    if (url.includes("/auth/v1/token")) {
      const refresh = (JSON.parse(String(init?.body)) as { refresh_token: string }).refresh_token;
      return new Response(JSON.stringify(sessionFor(refresh.replace("synthetic-refresh-", ""))));
    }
    throw new Error(`Unexpected synthetic request: ${url}`);
  }));
  // A remembered sign-in for account A, as an earlier visit left it.
  document.cookie = "pubmax_resume_gen=g0; Path=/";
  applySetCookies(await POST(routeRequest("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sessionFor("account-a").access_token}` },
    body: JSON.stringify({ action: "persist", refreshToken: sessionFor("account-a").refresh_token }),
  })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(HandlePasswordSignIn)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const { __resetPintDrops } = await import("@/lib/pintDrops");
  __resetPintDrops();
});

describe("a password sign-in and the remembered sign-in", () => {
  it.each([
    ["the password is wrong", () => { harness.signIn = async () => null; }],
    ["the network is down", () => { transportDown = true; }],
  ])("keeps the remembered account when %s", async (_label, fail) => {
    fail();
    await submitPassword();
    expect(host.textContent).not.toContain("Signing in");
    transportDown = false;
    expect(await redeemedAccount()).toBe("account-a");
  });

  it("remembers the account a password sign-in produced", async () => {
    harness.signIn = async () => sessionFor("account-b");
    await submitPassword();
    await vi.waitFor(async () => expect(await redeemedAccount()).toBe("account-b"));
  });

  it("does not let a password sign-in response that lands after a sign-out remember anyone", async () => {
    harness.signIn = async () => sessionFor("account-b");
    // Answered by the server before the sign-out; its page never reads it.
    const late = await handlePassword(routeRequest("/api/auth/handle-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "fixture_b", password: "correct horse battery" }),
    }));
    await clearPersistedSession(readResumeGeneration());
    applySetCookies(late);
    expect(await redeemedAccount()).toBeNull();
  });

  it("does not install a password sign-in that another document's sign-in overtook", async () => {
    harness.signIn = async () => sessionFor("account-b");
    let release = () => {};
    harness.holdHandlePassword = new Promise<void>((resolve) => { release = resolve; });
    await submitPassword();
    // Meanwhile account C signs in from another document.
    expect(commitSignIn(readResumeGeneration(), sessionFor("account-c").access_token)).not.toBeNull();
    expect(await persistSessionForResume(sessionFor("account-c"))).toBe("stored");
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(harness.installs).toEqual([]);
    expect(host.textContent).toContain("Sign-in did not finish. Try again.");
    expect(readResumeGeneration()).toMatch(/~account-c$/);
    expect(await redeemedAccount()).toBe("account-c");
  });
});

