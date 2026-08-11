import { describe, expect, it } from "vitest";

import { defaultEmailAuthNext } from "@/lib/authRedirect";
import {
  inviteReturnToFromUrl,
  safeInviteReturnTo,
} from "@/lib/inviteReturnTo";

describe("invite return navigation", () => {
  it.each([
    "https://example.com/add/karan",
    "//example.com/add/karan",
    "javascript:alert(1)",
  ])("rejects unsafe return target %s", (raw) => {
    expect(safeInviteReturnTo(raw)).toBeNull();
  });

  it("accepts only a plain add path", () => {
    expect(safeInviteReturnTo("/add/karan")).toBe("/add/karan");
    expect(safeInviteReturnTo("/u/you")).toBeNull();
    expect(safeInviteReturnTo("/add/karan?next=/map")).toBeNull();
  });

  it("keeps a valid invite through the account claim callback", () => {
    const url = "https://pubmaxxing.com/u/you?returnTo=%2Fadd%2Fkaran";

    expect(inviteReturnToFromUrl(url)).toBe("/add/karan");
    expect(defaultEmailAuthNext(url)).toBe("/u/you?returnTo=%2Fadd%2Fkaran");
  });

  it("drops an unsafe invite before account callback navigation", () => {
    const url = "https://pubmaxxing.com/u/you?returnTo=https%3A%2F%2Fevil.example";

    expect(inviteReturnToFromUrl(url)).toBeNull();
    expect(defaultEmailAuthNext(url)).toBe("/u/you");
  });
});
