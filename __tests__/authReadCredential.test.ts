// The Social read credential: an HMAC-signed HttpOnly cookie the cookie lane
// verifies locally, so an ambient GET never spends the refresh token the
// browser and the resume cookie share. See lib/authReadCredential.server.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_READ_COOKIE,
  authReadCredentialFromHeader,
  authReadSetCookie,
  mintAuthReadCredential,
  verifyAuthReadCredential,
} from "@/lib/authReadCredential.server";

const USER_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.stubEnv("PLAN_IDEMPOTENCY_SECRET", "test-signing-secret-test-signing-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the signed read credential", () => {
  it("round-trips a minted credential to its account", () => {
    const now = 1_800_000_000_000;
    const token = mintAuthReadCredential(USER_ID, now);
    expect(token).toBeTruthy();
    expect(verifyAuthReadCredential(token, now)).toBe(USER_ID);
  });

  it("refuses a credential minted for a different account", () => {
    const now = 1_800_000_000_000;
    const token = mintAuthReadCredential("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", now)!;
    expect(verifyAuthReadCredential(token, now)).not.toBe(USER_ID);
  });

  it("refuses a tampered signature and a forged payload", () => {
    const now = 1_800_000_000_000;
    const token = mintAuthReadCredential(USER_ID, now)!;
    const [payload, signature] = token.split(".") as [string, string];
    expect(verifyAuthReadCredential(`${payload}.${signature.slice(0, -2)}aa`, now)).toBeNull();
    const forged = Buffer.from(
      JSON.stringify({ v: 1, uid: USER_ID, exp: now + 10_000 }),
    ).toString("base64url");
    expect(verifyAuthReadCredential(`${forged}.${signature}`, now)).toBeNull();
    expect(verifyAuthReadCredential("not-a-credential", now)).toBeNull();
    expect(verifyAuthReadCredential("", now)).toBeNull();
  });

  it("refuses an expired credential", () => {
    const now = 1_800_000_000_000;
    const token = mintAuthReadCredential(USER_ID, now)!;
    expect(verifyAuthReadCredential(token, now + 24 * 60 * 60 * 1000 + 1)).toBeNull();
    expect(verifyAuthReadCredential(token, now + 24 * 60 * 60 * 1000)).toBeNull();
    expect(verifyAuthReadCredential(token, now + 24 * 60 * 60 * 1000 - 1)).toBe(USER_ID);
  });

  it("never mints without a user id", () => {
    expect(mintAuthReadCredential("", 1)).toBeNull();
    expect(mintAuthReadCredential("   ", 1)).toBeNull();
  });
});

describe("the cookie envelope", () => {
  it("writes and clears an HttpOnly Lax cookie", () => {
    vi.stubEnv("NODE_ENV", "production");
    const set = authReadSetCookie(USER_ID, 1_800_000_000_000);
    expect(set).toContain(`${AUTH_READ_COOKIE}=`);
    expect(set.toLowerCase()).toContain("httponly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/");
    expect(set).toContain("Secure");
    const clear = authReadSetCookie(null);
    expect(clear).toContain(`${AUTH_READ_COOKIE}=;`);
    expect(clear).toContain("Max-Age=0");
  });

  it("reads its own value from a Cookie header and nothing else", () => {
    const now = 1_800_000_000_000;
    const token = mintAuthReadCredential(USER_ID, now)!;
    const header = `other=x; ${AUTH_READ_COOKIE}=${encodeURIComponent(token)}; another=y`;
    expect(authReadCredentialFromHeader(header)).toBe(token);
    expect(authReadCredentialFromHeader("other=x")).toBeNull();
    expect(authReadCredentialFromHeader(null)).toBeNull();
    // A malformed percent-escape reads as absent, never throws.
    expect(authReadCredentialFromHeader(`${AUTH_READ_COOKIE}=%zz`)).toBeNull();
  });
});
