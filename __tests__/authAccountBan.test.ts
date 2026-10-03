import { describe, expect, it } from "vitest";

import {
  AUTH_ACCOUNT_BANNED_MESSAGE,
  isAuthUserBannedUntil,
  isGoTrueUserBannedError,
} from "@/lib/authAccountBan";

describe("auth account ban detection", () => {
  it("recognises GoTrue user_banned errors", () => {
    expect(isGoTrueUserBannedError({ code: "user_banned" })).toBe(true);
    expect(isGoTrueUserBannedError({ message: "User is banned" })).toBe(true);
    expect(isGoTrueUserBannedError({ code: "invalid_grant" })).toBe(false);
  });

  it("reads banned_until on the auth user", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isAuthUserBannedUntil({ banned_until: future })).toBe(true);
    expect(isAuthUserBannedUntil({ banned_until: "2000-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("ships the community-guidelines ban copy", () => {
    expect(AUTH_ACCOUNT_BANNED_MESSAGE).toContain("community guidelines");
    expect(AUTH_ACCOUNT_BANNED_MESSAGE).not.toMatch(/[—–]/);
  });
});
