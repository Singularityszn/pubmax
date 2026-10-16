import { afterEach, describe, expect, it, vi } from "vitest";

import {
  claimSignupReferral,
  claimSignupReferralFromAuthCallback,
  withReferralSignupProof,
} from "@/lib/referralClaimClient";

const AUTH_ATTEMPT = {
  ok: true,
  id: "a".repeat(32),
  callbackUrl:
    "https://pubmaxxing.com/auth/callback?_authAttempt=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
} as const;

describe("same-journey referral claim", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not store a follow handle when ownership changes during response parsing", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("window", { sessionStorage: { setItem } });
    let finish!: (value: { inviterHandle: string }) => void;
    const json = vi.fn(() => new Promise<{ inviterHandle: string }>((resolve) => { finish = resolve; }));
    const request = vi.fn(async () => ({ ok: true, json }) as unknown as Response);
    let current = true;
    const claim = claimSignupReferral("opaque_code_123456789", AUTH_ATTEMPT.id, "signed-proof", request, () => current);
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
    current = false;
    finish({ inviterHandle: "captured_friend" });
    await claim;
    expect(setItem).not.toHaveBeenCalled();
  });

  it("does not retry under a new account after the original ownership expires", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }));
    let current = true;
    const claim = claimSignupReferral("opaque_code_123456789", AUTH_ATTEMPT.id, "signed-proof", request, () => current);
    await vi.advanceTimersByTimeAsync(249);
    expect(request).toHaveBeenCalledOnce();
    current = false;
    await vi.advanceTimersByTimeAsync(1);
    await claim;
    expect(request).toHaveBeenCalledOnce();
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

  it("preserves auth when optional proof issuance fails", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ retryable: true }), { status: 503 }),
    );

    await expect(
      withReferralSignupProof(
        AUTH_ATTEMPT,
        "https://pubmaxxing.com/#referral=opaque_code_123456789",
        request,
      ),
    ).resolves.toEqual(AUTH_ATTEMPT);
  });

  it("abandons stalled proof issuance after a short timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null = null;
    const request = (
      _input: string,
      init?: RequestInit,
    ): Promise<Response> => {
      signal = init?.signal ?? null;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(signal?.reason),
          { once: true },
        );
      });
    };

    const prepared = withReferralSignupProof(
      AUTH_ATTEMPT,
      "https://pubmaxxing.com/#referral=opaque_code_123456789",
      request,
    );

    await vi.advanceTimersByTimeAsync(3_000);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    await expect(prepared).resolves.toEqual(AUTH_ATTEMPT);
  });

  it("scrubs the referral fragment before retry backoff", async () => {
    vi.useFakeTimers();
    const replacements: string[] = [];
    const request = vi.fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const claim = claimSignupReferralFromAuthCallback({
      currentUrl:
        "https://pubmaxxing.com/?city=london#referral=opaque_code_123456789&section=prices",
      callback: {
        attemptId: AUTH_ATTEMPT.id,
        tokens: { accessToken: "header.payload.signature", refreshToken: "refresh-token-1" },
        providerError: false,
        signupProof: "signed-proof",
      },
      request,
      replaceUrl: (url) => replacements.push(url),
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(replacements).toEqual(["/?city=london#section=prices"]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(claim).resolves.toBeUndefined();
    expect(replacements).toEqual(["/?city=london#section=prices"]);
  });
});
