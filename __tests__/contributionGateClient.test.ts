import { describe, expect, it, vi } from "vitest";

import {
  checkContributionGate,
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
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "eligible" }), { status: 200 }),
    );
    await expect(
      submitContributionAge("2000-01-01", request),
    ).resolves.toEqual({ status: "eligible" });
    expect(request).toHaveBeenCalledWith(
      "/api/identity/contribution-gate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ dateOfBirth: "2000-01-01" }),
      }),
    );
  });
});
