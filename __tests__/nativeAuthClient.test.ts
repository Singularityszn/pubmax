// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginCoordinatedAuthAttempt } from "@/lib/authRedirect";
import { completeNativeIOSOAuth } from "@/lib/nativeIOSOAuth";
import { createNativeAuthClient, ensureSupabaseBrowser, finishNativeSessionInstallation, installNativeSession } from "@/lib/authClient";

vi.mock("@supabase/supabase-js", { spy: true });

beforeEach(() => {
  vi.mocked(createClient).mockClear();
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://native-auth-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_offline_test_fixture");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the installed SDK's disposable native PKCE client", () => {
  it.each([
    ["secret key", "sb_secret_offline_test_fixture"],
    ["service-role JWT", `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.offline-signature`],
    ["unknown key", "unclassified_offline_test_fixture"],
  ])("rejects %s in the production public-key setting before SDK construction", async (_label, key) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await createNativeAuthClient("a".repeat(32))).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps independent verifiers in memory and never changes browser storage", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("native-auth-test.supabase.co/auth/v1/token");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("apikey")).toBe("sb_publishable_offline_test_fixture");
      expect(headers.get("authorization")).toBe("Bearer sb_publishable_offline_test_fixture");
      return Response.json({ error: "invalid_grant", error_description: "offline fixture" }, { status: 400 });
    });
    vi.stubGlobal("fetch", fetch);
    localStorage.setItem("existing-browser-account", "preserved");
    const first = await createNativeAuthClient("a".repeat(32));
    const second = await createNativeAuthClient("b".repeat(32));
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const one = await first!.auth.signInWithOAuth({ provider: "google", options: { skipBrowserRedirect: true } });
    const two = await second!.auth.signInWithOAuth({ provider: "apple", options: { skipBrowserRedirect: true } });
    const firstUrl = new URL(one.data.url!);
    const secondUrl = new URL(two.data.url!);
    expect(firstUrl.searchParams.get("code_challenge_method")).toBe("s256");
    expect(secondUrl.searchParams.get("code_challenge_method")).toBe("s256");
    expect(firstUrl.searchParams.get("code_challenge")).not.toBe(secondUrl.searchParams.get("code_challenge"));
    await first!.auth.exchangeCodeForSession("first-one-use-code");
    await second!.auth.exchangeCodeForSession("second-one-use-code");
    expect(fetch).toHaveBeenCalledTimes(2);
    const body = (index: number) => JSON.parse(String(fetch.mock.calls[index]![1]!.body)) as { auth_code: string; code_verifier: string };
    const firstBody = body(0);
    const secondBody = body(1);
    expect(firstBody.auth_code).toBe("first-one-use-code");
    expect(secondBody.auth_code).toBe("second-one-use-code");
    expect(createHash("sha256").update(firstBody.code_verifier).digest("base64url")).toBe(firstUrl.searchParams.get("code_challenge"));
    expect(createHash("sha256").update(secondBody.code_verifier).digest("base64url")).toBe(secondUrl.searchParams.get("code_challenge"));
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("existing-browser-account")).toBe("preserved");
    await first!.auth.stopAutoRefresh();
    await second!.auth.stopAutoRefresh();
  });
});


it("executes the native provider consumer through the public browser SDK boundary", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const accessToken = `e30.${Buffer.from(JSON.stringify({ sub: "native-owner", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.unsigned`;
  const user = { id: "native-owner" };
  const session = { access_token: accessToken, refresh_token: "native-owner-refresh", user, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  let challenge = "";
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://native-auth-test.supabase.co");
    expect(new Headers(init?.headers).get("apikey")).toBe("sb_publishable_offline_test_fixture");
    if (url.pathname === "/auth/v1/token") {
      const body = JSON.parse(String(init?.body));
      expect(body.auth_code).toBe("one-use-code");
      expect(createHash("sha256").update(body.code_verifier).digest("base64url")).toBe(challenge);
      return Response.json(session);
    }
    expect(url.pathname).toBe("/auth/v1/user");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${accessToken}`);
    return Response.json(user);
  });
  vi.stubGlobal("fetch", request);
  const ownership = { persistentStorage: localStorage, tabStorage: sessionStorage, lockManager: { request: async (_name: string, callback: () => Promise<unknown>) => callback() } as unknown as LockManager };
  const attempt = await beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, { ...ownership, cryptoProvider: crypto });
  if (!attempt.ok) throw new Error(attempt.message);
  const canonical = await ensureSupabaseBrowser();
  expect(canonical).not.toBeNull();
  const result = await completeNativeIOSOAuth("google", attempt, {
    ownership, current: () => true,
    authenticate: async ({ url, attemptId }) => {
      const started = new URL(url);
      expect(started.pathname).toBe("/auth/v1/authorize");
      expect(started.searchParams.get("code_challenge_method")).toBe("s256");
      challenge = started.searchParams.get("code_challenge")!;
      return { url: `pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=${attemptId}#` };
    },
    install: (verified) => installNativeSession(canonical!.auth, verified, () => true),
  });
  expect(result?.session.user.id).toBe("native-owner");
  expect(finishNativeSessionInstallation(result!.session)).toBe(true);
  expect((await canonical!.auth.getSession()).data.session?.user.id).toBe("native-owner");
  expect(request).toHaveBeenCalledTimes(3);
  expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index)).some((key) => key?.startsWith("pubmax-native-auth-"))).toBe(false);
  await canonical!.auth.stopAutoRefresh();
});


it("refuses native installation when the canonical SDK has only fallback memory storage", async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", undefined);
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  const boundary = await import("@/lib/authClient");
  const canonical = await boundary.ensureSupabaseBrowser();
  expect(canonical).not.toBeNull();
  const session = { access_token: "native-access", refresh_token: "native-refresh", user: { id: "native-owner" } } as import("@supabase/supabase-js").Session;
  expect(await boundary.installNativeSession(canonical!.auth, session, () => true)).toBeNull();
  expect((await canonical!.auth.getSession()).data.session).toBeNull();
  expect(request).not.toHaveBeenCalled();
  await canonical!.auth.stopAutoRefresh();
});
