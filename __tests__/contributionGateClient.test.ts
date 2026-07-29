import { describe, expect, it, vi } from "vitest";

import {
  checkContributionGate,
  dateOfBirthAfterAssessment,
  submitContributionAge,
} from "@/lib/contributionGateClient";

describe("contribution gate client", () => {
  it("reads each server-owned gate state without inferring from copy", async () => {
    for (const status of [
      "eligible",
      "age_required",
      "onboarding_required",
      "underage",
    ] as const) {
      const request = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status,
            ...(status === "underage"
              ? { eligibleOn: "2028-07-30" }
              : {}),
          }),
          { status: status === "eligible" ? 200 : 403 },
        ),
      );
      await expect(checkContributionGate(request)).resolves.toMatchObject({
        status,
      });
    }
  });

  it("treats a 401 as sign-in required", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Sign in." }), { status: 401 }),
    );
    await expect(checkContributionGate(request)).resolves.toEqual({
      status: "sign_in_required",
      error: "Sign in.",
    });
  });

  it("submits date of birth once and returns only derived eligibility", async () => {
    const auth = { userId: "user-a", accessToken: "token-a" };
    const request = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(JSON.stringify({ status: "eligible" }), {
          status: 200,
        });
      },
    );
    await expect(
      submitContributionAge("2000-01-01", auth, request),
    ).resolves.toEqual({ status: "eligible" });
    expect(request).toHaveBeenCalledWith(
      "/api/identity/contribution-gate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ dateOfBirth: "2000-01-01" }),
        headers: expect.any(Headers),
      }),
    );
    const headers = new Headers(request.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer token-a");
  });

  it("discards date of birth after either derived age decision", () => {
    expect(
      dateOfBirthAfterAssessment("2000-01-01", { status: "eligible" }),
    ).toBe("");
    expect(
      dateOfBirthAfterAssessment("2010-07-30", {
        status: "underage",
        eligibleOn: "2028-07-30",
      }),
    ).toBe("");
    expect(
      dateOfBirthAfterAssessment("2000-01-01", {
        status: "unavailable",
        error: "Try again.",
      }),
    ).toBe("2000-01-01");
  });
});
