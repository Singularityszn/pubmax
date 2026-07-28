import { describe, expect, it, vi } from "vitest";

import { claimSignupReferral } from "@/lib/referralClaimClient";

describe("same-journey referral claim", () => {
  it("retries retryable failures before completing the handoff", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retryable: true }), { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ attributed: true }), { status: 200 }),
      );

    await expect(
      claimSignupReferral("opaque_code_123456789", request),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenLastCalledWith(
      "/api/referrals/claim-attribution",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "opaque_code_123456789" }),
      }),
    );
  });

  it("stops after a terminal response", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ attributed: false }), { status: 200 }),
    );

    await claimSignupReferral("opaque_code_123456789", request);
    expect(request).toHaveBeenCalledOnce();
  });
});
