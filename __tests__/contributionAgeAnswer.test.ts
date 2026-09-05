import { beforeEach, describe, expect, it, vi } from "vitest";

// ONE RULE (captain, 5 Sep 2026). The contribution gate asks the SAME age
// question the 10 Aug rule wrote down: a stored date of birth, or the recorded
// one tap. Nothing here is a second reading of what an adult is, which is why
// `needsAdultSelfAssertion` is the only predicate the gate calls.

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", () => ({
  verifyCallerAuth: async () =>
    authState.userId
      ? {
          status: "verified" as const,
          identity: { id: authState.userId, email: null, createdAt: null },
        }
      : { status: "absent" as const },
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import {
  __resetMemoryAdultSelfAssertions,
  memoryAdultSelfAssertionStore,
} from "@/lib/adultSelfAssertionStore";
import {
  CONTRIBUTION_ADULT_REFUSAL,
  CONTRIBUTION_HANDLE_REFUSAL,
  resolveContributionIdentity,
} from "@/lib/contributionIdentity.server";
import {
  __resetMemoryIdentityHandles,
  memoryIdentityHandleStore,
} from "@/lib/identityHandleStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

const request = new Request("http://localhost/api/contribution");

beforeEach(() => {
  authState.userId = null;
  __resetMemoryIdentityHandles();
  __resetMemoryProfiles();
  __resetMemoryPrivateIdentities();
  __resetMemoryAdultSelfAssertions();
});

describe("the contribution gate's age answer", () => {
  it("takes the recorded one tap", async () => {
    authState.userId = "user-tapped";
    expect(
      await memoryIdentityHandleStore.claim("user-tapped", "tapped_drinker"),
    ).toMatchObject({ ok: true });
    await memoryAdultSelfAssertionStore.record("user-tapped");

    await expect(resolveContributionIdentity(request)).resolves.toMatchObject({
      ok: true,
      accountId: "user-tapped",
      handle: "tapped_drinker",
    });
  });

  it("still takes a stored date of birth", async () => {
    authState.userId = "user-dated";
    expect(
      await memoryPrivateIdentityStore.completeOnboarding({
        userId: "user-dated",
        handle: "dated_drinker",
        dateOfBirth: "1990-01-01",
      }),
    ).toMatchObject({ ok: true });

    await expect(resolveContributionIdentity(request)).resolves.toMatchObject({
      ok: true,
      accountId: "user-dated",
      handle: "dated_drinker",
    });
  });

  it("refuses when the account has answered neither way", async () => {
    authState.userId = "user-silent";
    expect(
      await memoryIdentityHandleStore.claim("user-silent", "silent_drinker"),
    ).toMatchObject({ ok: true });

    await expect(resolveContributionIdentity(request)).resolves.toMatchObject({
      ok: false,
      httpStatus: 409,
      body: { status: "adult_check_required", error: CONTRIBUTION_ADULT_REFUSAL },
    });
  });

  it("names the missing handle apart from the missing age answer", async () => {
    // Two findings, two ways through. Merging them is what sent an account
    // that already held a handle to a claim surface that stores no birth date.
    authState.userId = "user-handleless";

    await expect(resolveContributionIdentity(request)).resolves.toMatchObject({
      ok: false,
      httpStatus: 409,
      body: {
        status: "onboarding_required",
        error: CONTRIBUTION_HANDLE_REFUSAL,
      },
    });
  });

  it("says neither sentence asks for a birth date", () => {
    expect(CONTRIBUTION_HANDLE_REFUSAL).not.toMatch(/birth/i);
    expect(CONTRIBUTION_ADULT_REFUSAL).not.toMatch(/birth/i);
  });
});
