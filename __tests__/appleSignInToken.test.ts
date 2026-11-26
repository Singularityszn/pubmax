import { describe, expect, it } from "vitest";
import {
  accountDeletionRequestInit,
  forgetAllAppleSignInTokens,
  forgetAppleSignInToken,
  keepAppleSignInToken,
  keptAppleSignInToken,
  markAppleSignInAttempt,
  webSignInProvider,
} from "@/lib/appleSignInToken";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
const ATTEMPT_A = "a".repeat(32);
const ATTEMPT_B = "b".repeat(32);
const owned = (attemptId: string | null, localAttemptOwned = true) => ({ attempt: { attemptId }, localAttemptOwned });

describe("Apple's refresh token on this device", () => {
  it("keeps the token for the account that signed in with Apple, and for no other account", () => {
    const local = storage();
    keepAppleSignInToken(local, { provider: "apple", userId: "account-a", refreshToken: "apple-refresh-a" });
    expect(keptAppleSignInToken(local, "account-a")).toEqual({ value: "apple-refresh-a", type: "refresh_token" });
    expect(keptAppleSignInToken(local, "account-b")).toBeNull();
  });

  it.each(["google", "azure", null] as const)("never keeps a token from a %s sign-in", (provider) => {
    const local = storage();
    keepAppleSignInToken(local, { provider, userId: "account-a", refreshToken: "provider-refresh" });
    expect(keptAppleSignInToken(local, "account-a")).toBeNull();
    expect(local.values.size).toBe(0);
  });

  it.each([undefined, null, "", "has space", "x".repeat(4097)])("keeps nothing for a malformed token %#", (refreshToken) => {
    const local = storage();
    keepAppleSignInToken(local, { provider: "apple", userId: "account-a", refreshToken });
    expect(keptAppleSignInToken(local, "account-a")).toBeNull();
  });

  it("keeps one token per account, and one account leaving takes only its own", () => {
    const local = storage();
    keepAppleSignInToken(local, { provider: "apple", userId: "account-a", refreshToken: "apple-refresh-a" });
    keepAppleSignInToken(local, { provider: "apple", userId: "account-b", refreshToken: "apple-refresh-b" });
    keepAppleSignInToken(local, { provider: "apple", userId: "account-a", refreshToken: "apple-refresh-a2" });
    expect(keptAppleSignInToken(local, "account-a")?.value).toBe("apple-refresh-a2");
    forgetAppleSignInToken(local, "account-a");
    expect(keptAppleSignInToken(local, "account-a")).toBeNull();
    expect(keptAppleSignInToken(local, "account-b")?.value).toBe("apple-refresh-b");
    forgetAllAppleSignInTokens(local);
    expect(keptAppleSignInToken(local, "account-b")).toBeNull();
  });

  it("reads blocked or corrupt storage as no token", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    expect(() => keepAppleSignInToken(blocked, { provider: "apple", userId: "account-a", refreshToken: "apple-refresh" })).not.toThrow();
    expect(keptAppleSignInToken(blocked, "account-a")).toBeNull();
    expect(keptAppleSignInToken(null, "account-a")).toBeNull();
    const corrupt = storage();
    corrupt.setItem("pubmax_apple_sign_in_tokens_v1", "{not json");
    expect(keptAppleSignInToken(corrupt, "account-a")).toBeNull();
  });
});

describe("the web return's sign-in provider", () => {
  it("is Apple only for the attempt this browser sent to Apple, and only once", () => {
    const local = storage();
    markAppleSignInAttempt(local, ATTEMPT_A);
    expect(webSignInProvider(local, owned(ATTEMPT_A))).toBe("apple");
    expect(webSignInProvider(local, owned(ATTEMPT_A))).toBeNull();
  });

  it.each([
    ["another attempt", owned(ATTEMPT_B)],
    ["an attempt this browser did not start", owned(ATTEMPT_A, false)],
    ["a return with no attempt", owned(null)],
  ])("is not Apple for %s", (_label, captured) => {
    const local = storage();
    markAppleSignInAttempt(local, ATTEMPT_A);
    expect(webSignInProvider(local, captured)).toBeNull();
  });

  it("is not Apple when no Apple sign-in started here", () => {
    expect(webSignInProvider(storage(), owned(ATTEMPT_A))).toBeNull();
  });
});

describe("the account deletion request", () => {
  it("carries the Apple token kept for the account being deleted", () => {
    const local = storage();
    keepAppleSignInToken(local, { provider: "apple", userId: "account-a", refreshToken: "apple-refresh-a" });
    const init = accountDeletionRequestInit(local, "account-a");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ appleToken: { value: "apple-refresh-a", type: "refresh_token" } });
  });

  it("sends no body for an account with no Apple token here", () => {
    const local = storage();
    keepAppleSignInToken(local, { provider: "apple", userId: "account-b", refreshToken: "apple-refresh-b" });
    expect(accountDeletionRequestInit(local, "account-a")).toEqual({ method: "DELETE" });
  });
});
