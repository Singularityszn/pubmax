import { describe, expect, it } from "vitest";

import { contributionReadRefusalResponse } from "@/lib/contributionReadRefusal.server";
import type { ContributionIdentityResolution } from "@/lib/contributionIdentity.server";

type Refusal = Extract<ContributionIdentityResolution, { ok: false }>;

// A read of your own record that only a gate stands in front of is data, not an
// error: the three gates answer at 200 with their own `{ status, error }` body,
// and every genuine refusal keeps its status.

const GATES: readonly Refusal[] = [
  {
    ok: false,
    body: { status: "adult_check_required", error: "Confirm you are 18 or over before contributing." },
    httpStatus: 409,
  },
  {
    ok: false,
    body: { status: "adult_check_failed", error: "The date of birth on your account is under 18." },
    httpStatus: 409,
  },
  {
    ok: false,
    body: { status: "onboarding_required", error: "Choose a public handle before contributing." },
    httpStatus: 409,
  },
];

describe("contributionReadRefusalResponse", () => {
  it.each(GATES)("answers $body.status at 200 with the same body", async (refusal) => {
    const response = contributionReadRefusalResponse(refusal);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(await response.json()).toEqual(refusal.body);
  });

  it("keeps a missing sign-in a 401", () => {
    const response = contributionReadRefusalResponse({
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    });

    expect(response.status).toBe(401);
  });

  it("keeps a banned account a 403 and an outage a 503", () => {
    expect(
      contributionReadRefusalResponse({
        ok: false,
        body: { code: "ACCOUNT_BANNED", error: "This account is banned." },
        httpStatus: 403,
      }).status,
    ).toBe(403);
    expect(
      contributionReadRefusalResponse({
        ok: false,
        body: { code: "AUTH_VERIFICATION_UNAVAILABLE", error: "Try again.", retryable: true },
        httpStatus: 503,
      }).status,
    ).toBe(503);
  });
});
