import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/push-tokens/route.ts. The route selects
// the process-memory pushTokenStore, pinned deterministically at the
// @/lib/supabase seam (isSupabaseConfigured() === false) — the house pattern
// (see commentsRoute.test.ts).
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { POST } from "@/app/api/push-tokens/route";
import { __listMemoryPushTokens, __resetMemoryPushTokens } from "@/lib/pushTokenStore";

const URL_BASE = "http://localhost/api/push-tokens";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request(URL_BASE, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  __resetMemoryPushTokens();
});

describe("POST /api/push-tokens", () => {
  it("registers a valid { token, platform } payload", async () => {
    const res = await post({ token: "apns-token-1", platform: "ios" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(__listMemoryPushTokens().map((t) => t.token)).toEqual(["apns-token-1"]);
  });

  it("is idempotent for a repeated token", async () => {
    await post({ token: "apns-token-1", platform: "ios" });
    const res = await post({ token: "apns-token-1", platform: "ios" });
    expect(res.status).toBe(200);
    expect(__listMemoryPushTokens()).toHaveLength(1);
  });

  it("400s on a malformed body", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Malformed request body." });
  });

  it("400s on a missing token", async () => {
    const res = await post({ platform: "ios" });
    expect(res.status).toBe(400);
    expect(__listMemoryPushTokens()).toHaveLength(0);
  });

  it("400s on an unknown platform", async () => {
    const res = await post({ token: "tok", platform: "web" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Platform must be ios or android." });
  });
});
