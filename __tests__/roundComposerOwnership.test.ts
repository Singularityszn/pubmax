import { describe, expect, it } from "vitest";

import { roundComposerOwnerKey } from "@/app/rounds/[code]/RoundPageClient";

describe("Round composer ownership", () => {
  it("changes scope when authenticated account owner changes", () => {
    expect(
      roundComposerOwnerKey({ userId: "user-a", accessToken: "token-a" }),
    ).not.toBe(
      roundComposerOwnerKey({ userId: "user-b", accessToken: "token-b" }),
    );
  });

  it("keeps scope across token refresh for one account", () => {
    expect(
      roundComposerOwnerKey({ userId: "user-a", accessToken: "token-a" }),
    ).toBe(
      roundComposerOwnerKey({ userId: "user-a", accessToken: "token-new" }),
    );
  });

  it("clears authenticated scope on sign-out", () => {
    expect(
      roundComposerOwnerKey({ userId: "user-a", accessToken: "token-a" }),
    ).not.toBe(roundComposerOwnerKey(null));
  });
});
