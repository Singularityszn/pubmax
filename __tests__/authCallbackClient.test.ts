import { describe, expect, it, vi } from "vitest";

import { establishAuthCallbackSession } from "@/lib/authCallbackClient";

describe("explicit implicit-flow callback completion", () => {
  it("returns the established session", async () => {
    const session = { access_token: "access" };
    const setSession = vi.fn().mockResolvedValue({
      data: { session },
      error: null,
    });

    await expect(
      establishAuthCallbackSession(
        { setSession },
        { accessToken: "access", refreshToken: "refresh" },
      ),
    ).resolves.toEqual({ session, failed: false });
    expect(setSession).toHaveBeenCalledOnce();
    expect(setSession).toHaveBeenCalledWith({
      access_token: "access",
      refresh_token: "refresh",
    });
  });

  it("normalizes provider and network failures", async () => {
    const providerFailure = vi.fn().mockResolvedValue({
      data: { session: null },
      error: { code: "bad_jwt" },
    });
    const networkFailure = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(
      establishAuthCallbackSession(
        { setSession: providerFailure },
        { accessToken: "expired", refreshToken: "refresh" },
      ),
    ).resolves.toEqual({ session: null, failed: true });
    await expect(
      establishAuthCallbackSession(
        { setSession: networkFailure },
        { accessToken: "access", refreshToken: "refresh" },
      ),
    ).resolves.toEqual({ session: null, failed: true });
  });
});
