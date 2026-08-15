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

  it("carries the one add-link parameter and refuses every other query", () => {
    // `?auto=1` is the whole reason a return may hold a query: it is what makes
    // a completed sign-up perform the add the person already chose.
    expect(safeInviteReturnTo("/add/karan?auto=1")).toBe("/add/karan?auto=1");
    expect(safeInviteReturnTo("/add/karan?auto=0")).toBeNull();
    expect(safeInviteReturnTo("/add/karan?auto=1&next=/map")).toBeNull();
    expect(safeInviteReturnTo("/add/karan?auto")).toBeNull();
    expect(safeInviteReturnTo("/u/you?auto=1")).toBeNull();
  });

  it("keeps the add-link parameter through the account claim callback", () => {
    const url = "https://pubmaxxing.com/u/you?returnTo=%2Fadd%2Fkaran%3Fauto%3D1";

    expect(inviteReturnToFromUrl(url)).toBe("/add/karan?auto=1");
    expect(defaultEmailAuthNext(url)).toBe(
      "/u/you?returnTo=%2Fadd%2Fkaran%3Fauto%3D1",
    );
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
