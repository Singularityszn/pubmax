// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeAuthClient } from "@/lib/nativeAuthClient";

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://native-auth-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_offline_test_fixture");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the installed SDK's disposable native PKCE client", () => {
  it("keeps independent verifiers in memory and never changes browser storage", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("native-auth-test.supabase.co/auth/v1/token");
      expect(init?.method).toBe("POST");
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
