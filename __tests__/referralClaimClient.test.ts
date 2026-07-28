import { afterEach, describe, expect, it, vi } from "vitest";

import { claimSignupReferral } from "@/lib/referralClaimClient";

describe("same-journey referral claim", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for Retry-After before retrying the live handoff", async () => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retryable: true }), {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ attributed: true }), { status: 200 }),
      );

    const claim = claimSignupReferral(
      "opaque_code_123456789",
      "a".repeat(32),
      "signed-proof",
      request,
    );

    await vi.advanceTimersByTimeAsync(1_999);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(claim).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      "/api/referrals/claim-attribution",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          code: "opaque_code_123456789",
          authAttemptId: "a".repeat(32),
          signupProof: "signed-proof",
        }),
      }),
    );
  });

  it("uses bounded backoff for retryable responses without Retry-After", async () => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const claim = claimSignupReferral(
      "opaque_code_123456789",
      "a".repeat(32),
      "signed-proof",
      request,
    );

    await vi.advanceTimersByTimeAsync(249);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(claim).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stops after a terminal response", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ attributed: false }), { status: 200 }),
    );

    await claimSignupReferral(
      "opaque_code_123456789",
      "a".repeat(32),
      "signed-proof",
      request,
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
