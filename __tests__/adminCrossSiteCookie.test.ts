import { afterEach, describe, expect, it, vi } from "vitest";

import { ADMIN_SESSION_COOKIE, isModerator, mintAdminSession } from "@/lib/adminAuth";

// The admin session cookie is SameSite=Lax, which a browser still attaches to a
// cross-site top-level POST. So a write that rides the cookie from another site
// is refused (security audit, 18 Oct 2026); the header token, which another
// site cannot set, and same-site writes are unaffected.
const TOKEN = "a-moderator-token-that-is-long-enough-123";
const URL_ADMIN = "https://pubmaxx.com/api/admin/comments";

function cookieRequest(method: string, headers: Record<string, string> = {}): Request {
  return new Request(URL_ADMIN, {
    method,
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(mintAdminSession(TOKEN))}`,
      ...headers,
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isModerator over the session cookie", () => {
  it("refuses a cross-site write that rides the cookie", () => {
    vi.stubEnv("ADMIN_TOKEN", TOKEN);
    expect(isModerator(cookieRequest("POST", { "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isModerator(cookieRequest("PATCH", { origin: "https://evil.example" }))).toBe(false);
    expect(isModerator(cookieRequest("DELETE", { origin: "null" }))).toBe(false);
  });

  it("admits a same-site write and any cookie read", () => {
    vi.stubEnv("ADMIN_TOKEN", TOKEN);
    expect(isModerator(cookieRequest("POST", { "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isModerator(cookieRequest("PATCH", { origin: "https://pubmaxx.com" }))).toBe(true);
    expect(isModerator(cookieRequest("POST"))).toBe(true);
    expect(isModerator(cookieRequest("GET", { "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("leaves the header token alone, because another site cannot set it", () => {
    vi.stubEnv("ADMIN_TOKEN", TOKEN);
    const request = new Request(URL_ADMIN, {
      method: "POST",
      headers: { "x-admin-token": TOKEN, "sec-fetch-site": "cross-site" },
    });
    expect(isModerator(request)).toBe(true);
  });

  it("still refuses a forged or missing cookie", () => {
    vi.stubEnv("ADMIN_TOKEN", TOKEN);
    const forged = new Request(URL_ADMIN, {
      method: "POST",
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=v1.1.${"0".repeat(64)}` },
    });
    expect(isModerator(forged)).toBe(false);
    expect(isModerator(new Request(URL_ADMIN, { method: "POST" }))).toBe(false);
  });
});
