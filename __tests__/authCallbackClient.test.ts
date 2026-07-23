import { describe, expect, it, vi } from "vitest";

import { exchangeAuthCallbackCode } from "@/lib/authCallbackClient";

describe("explicit PKCE callback exchange", () => {
  it("returns the exchanged session", async () => {
    const session = { access_token: "access" };
    const exchangeCodeForSession = vi.fn().mockResolvedValue({
      data: { session },
      error: null,
    });

    await expect(exchangeAuthCallbackCode({ exchangeCodeForSession }, "pkce-code"))
      .resolves.toEqual({ session, failed: false });
    expect(exchangeCodeForSession).toHaveBeenCalledOnce();
    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
  });

  it("normalizes provider and missing-verifier failures", async () => {
    const providerFailure = vi.fn().mockResolvedValue({
      data: { session: null },
      error: { code: "bad_code_verifier" },
    });
    const missingVerifier = vi.fn().mockRejectedValue(new Error("code verifier missing"));

    await expect(exchangeAuthCallbackCode({ exchangeCodeForSession: providerFailure }, "expired"))
      .resolves.toEqual({ session: null, failed: true });
    await expect(exchangeAuthCallbackCode({ exchangeCodeForSession: missingVerifier }, "cross-browser"))
      .resolves.toEqual({ session: null, failed: true });
  });
});
