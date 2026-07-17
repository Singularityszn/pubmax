import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/push-tokens/route.ts. The route selects
// the process-memory pushTokenStore, pinned deterministically at the
// @/lib/supabase seam (isSupabaseConfigured() === false) — the house pattern
// (see commentsRoute.test.ts). The per-IP limiter is mocked at the
// @/lib/pintDrops seam exactly like planGenerateRoute.test.ts so the 429 path
// and key derivation are asserted without a live budget.
const { isLimitedMock } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async (...args: [
    localKey: string,
    durableKey: string,
    limit?: number,
    windowMs?: number,
  ]) => {
    void args;
    return false;
  }),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});

import { POST } from "@/app/api/push-tokens/route";
import { __listMemoryPushTokens, __resetMemoryPushTokens } from "@/lib/pushTokenStore";

const URL_BASE = "http://localhost/api/push-tokens";

function post(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return POST(
    new Request(URL_BASE, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

beforeEach(() => {
  __resetMemoryPushTokens();
  isLimitedMock.mockClear();
  isLimitedMock.mockResolvedValue(false);
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

  it("400s on a malformed body in the flat public envelope", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Malformed request body.",
      code: "MALFORMED_REQUEST",
      retryable: false,
    });
  });

  it("400s on a missing token", async () => {
    const res = await post({ platform: "ios" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "A device token is required.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect(__listMemoryPushTokens()).toHaveLength(0);
  });

  it("400s on an unknown platform", async () => {
    const res = await post({ token: "tok", platform: "web" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Platform must be ios or android.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
  });

  it("rate-limits per hashed IP and preserves the flat 429 contract", async () => {
    await post({ token: "tok-a", platform: "ios" }, { "x-real-ip": "203.0.113.7" });
    const [localKey, durableKey, limit, windowMs] = isLimitedMock.mock.calls[0] ?? [];
    expect(localKey).toMatch(/^push-tokens:/);
    expect(localKey).toBe(durableKey);
    // The raw IP never becomes a limiter key — only its hash.
    expect(String(localKey)).not.toContain("203.0.113.7");
    expect(limit).toBe(10);
    expect(windowMs).toBe(60 * 60 * 1000);

    isLimitedMock.mockResolvedValueOnce(true);
    const limited = await post({ token: "tok-b", platform: "ios" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "Too many registrations, slow down.",
      code: "RATE_LIMITED",
      retryable: true,
    });
    // A limited request never reaches the store.
    expect(__listMemoryPushTokens().map((t) => t.token)).toEqual(["tok-a"]);
  });

  it("skips the limiter entirely for invalid payloads", async () => {
    await post({ token: "", platform: "ios" });
    expect(isLimitedMock).not.toHaveBeenCalled();
  });
});
