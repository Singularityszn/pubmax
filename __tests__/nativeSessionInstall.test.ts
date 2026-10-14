// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type Session } from "@supabase/supabase-js";
import { discardCancelledNativeSessionInstallation, ensureSupabaseBrowser, installNativeSession } from "@/lib/authClient";

function token(id: string) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"),
    "unsigned",
  ].join(".");
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("native installation through the installed Supabase SDK", () => {
  it("refuses to replace B when A verifies but a second A lookup would report session_not_found", async () => {
    const a = token("account-a");
    const b = token("account-b");
    let aReads = 0;
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/auth/v1/user");
      const bearer = new Headers(init?.headers).get("authorization");
      if (bearer === `Bearer ${b}`) return Response.json({ id: "account-b" });
      if (bearer === `Bearer ${a}` && ++aReads === 1) return Response.json({ id: "account-a" });
      return Response.json({ code: "session_not_found", message: "Session does not exist" }, { status: 400, headers: { "x-supabase-api-version": "2024-01-01" } });
    });
    vi.stubGlobal("fetch", request);
    const canonical = createClient("https://offline-auth-test.supabase.co", "sb_publishable_offline_fixture", {
      global: { fetch: request },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "offline-canonical" },
    });
    const ephemeral = createClient("https://offline-auth-test.supabase.co", "sb_publishable_offline_fixture", {
      global: { fetch: request },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "offline-native", flowType: "pkce" },
    });
    await canonical.auth.setSession({ access_token: b, refresh_token: "account-b-refresh" });
    expect((await ephemeral.auth.getUser(a)).data.user?.id).toBe("account-a");
    const result = await installNativeSession(canonical.auth, {
      access_token: a, refresh_token: "account-a-refresh", user: { id: "account-a" },
    } as Session, () => true);
    expect((await canonical.auth.getSession()).data.session?.user.id).toBe("account-b");
    expect(result).toBeNull();
    expect(aReads).toBe(1);
    await canonical.auth.stopAutoRefresh();
    await ephemeral.auth.stopAutoRefresh();
  });

  it("leaves a signed-out native attempt signed out if canonical verification rejects its session", async () => {
    const request = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toContain("/auth/v1/user");
      return Response.json({ code: "session_not_found", message: "Session does not exist" }, { status: 400, headers: { "x-supabase-api-version": "2024-01-01" } });
    });
    const canonical = createClient("https://offline-auth-test.supabase.co", "sb_publishable_offline_fixture", {
      global: { fetch: request },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "offline-signed-out" },
    });
    const result = await installNativeSession(canonical.auth, {
      access_token: token("account-a"), refresh_token: "account-a-refresh", user: { id: "account-a" },
    } as Session, () => true);
    expect(result?.error?.name).toBe("AuthSessionMissingError");
    expect((await canonical.auth.getSession()).data.session).toBeNull();
    await canonical.auth.stopAutoRefresh();
  });
});


it("preserves a concurrently restored canonical account during native verification and rejection", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://offline-auth-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_offline_fixture");
  let release!: () => void;
  let verifying = false;
  let reject = false;
  let current = true;
  const a = token("account-a");
  const b = token("account-b");
  const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toContain("/auth/v1/user");
    if (new Headers(init?.headers).get("authorization") === `Bearer ${b}`) return Response.json({ id: "account-b" });
    verifying = true;
    await new Promise<void>((resolve) => { release = resolve; });
    return reject ? Response.json({ code: "session_not_found", message: "Session does not exist" }, { status: 400, headers: { "x-supabase-api-version": "2024-01-01" } }) : Response.json({ id: "account-a" });
  });
  vi.stubGlobal("fetch", request);
  const canonical = await ensureSupabaseBrowser();
  expect(canonical).not.toBeNull();
  for (reject of [false, true]) {
    localStorage.removeItem("sb-offline-auth-test-auth-token");
    verifying = false; current = true;
    const installation = installNativeSession(canonical!.auth, { access_token: a, refresh_token: "account-a-refresh", user: { id: "account-a" } } as Session, () => current);
    await vi.waitFor(() => expect(verifying).toBe(true));
    await canonical!.auth.setSession({ access_token: b, refresh_token: "account-b-refresh" });
    current = false;
    discardCancelledNativeSessionInstallation();
    release();
    expect(await installation).toBeNull();
    expect((await canonical!.auth.getSession()).data.session?.user.id).toBe("account-b");
    expect((await canonical!.auth.getSession()).data.session?.refresh_token).toBe("account-b-refresh");
  }
  await canonical!.auth.stopAutoRefresh();
});
