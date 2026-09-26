import { describe, expect, it } from "vitest";

import { isUserSignUp } from "@/lib/userSignedUp";

const NOW = Date.parse("2026-09-26T20:07:00Z");

describe("user_signed_up detection", () => {
  it("counts an email link opened seven minutes after it was requested", () => {
    expect(isUserSignUp({
      created_at: "2026-09-26T20:00:00Z",
      confirmed_at: "2026-09-26T20:07:00Z",
    } as { confirmed_at: string }, NOW)).toBe(true);
  });

  it("does not count a returning account's sign-in", () => {
    expect(isUserSignUp({ confirmed_at: "2026-09-20T20:00:00Z" }, NOW)).toBe(false);
  });

  it("does not count an account that was never verified", () => {
    expect(isUserSignUp({}, NOW)).toBe(false);
    expect(isUserSignUp({ confirmed_at: null }, NOW)).toBe(false);
  });
});
