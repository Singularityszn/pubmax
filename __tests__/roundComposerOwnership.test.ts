import { describe, expect, it } from "vitest";

import {
  roundComposerOwnerKey,
  roundViewerHandle,
} from "@/app/rounds/[code]/RoundPageClient";
import type { RoundRequestIdentity } from "@/lib/roundRequest";

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

  it("ignores another account's viewer projection and stored handle", () => {
    const accountB: RoundRequestIdentity = {
      kind: "account",
      auth: { userId: "user-b", accessToken: "token-b" },
    };

    expect(
      roundViewerHandle(
        "account-a-handle",
        "account:user-a",
        accountB,
        "account-b-handle",
        "account-a-handle",
      ),
    ).toBe("account-b-handle");
    expect(
      roundViewerHandle(
        "account-a-handle",
        "account:user-a",
        accountB,
        null,
        "account-a-handle",
      ),
    ).toBe("");
  });
});
