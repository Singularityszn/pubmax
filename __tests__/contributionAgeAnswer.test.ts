import { beforeEach, describe, expect, it, vi } from "vitest";

// ONE RULE, ONE EXCEPTION. The contribution gate asks the SAME age question the
// 10 Aug rule wrote down: a stored date of birth decides in both directions,
// and only where there is none does the recorded one tap answer. Nothing here
// is a second reading of what an adult is: `accountIsAdult` judges the age and
// `needsAdultSelfAssertion` says only whether a tap is the ACTUAL thing in the
// way, which is what picks WHICH refusal is spent.
//
// Review finding F-6 (5 Sep 2026): the gate used to ask `needsAdultSelfAssertion`
// ALONE, which is true only when NOBODY has answered, so an account whose
// stored date of birth said 2012 walked through the price door while the pub
// photo wall next to it refused the same account. Two doors on one product
// answered the alcohol-age question two ways, and the sentence the price door
// spent claimed an 18+ confirmation it had never asked for.

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
  contributionAdultRefusal,
  CONTRIBUTION_ADULT_REFUSAL,
  CONTRIBUTION_HANDLE_REFUSAL,
  CONTRIBUTION_UNDER_18_REFUSAL,
  resolveContributionIdentity,
} from "@/lib/contributionIdentity.server";
import { accountIsAdult, needsAdultSelfAssertion } from "@/lib/socialLaunch";
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

  it("refuses an account claimed with no date of birth until it taps", async () => {
    // ONE RULE (captain, 5 Sep 2026). The claim card no longer demands a date
    // of birth, so this is the ORDINARY new account rather than a legacy one:
    // it holds a handle, no identity row and no tap, and the gate asks for the
    // tap alone. The tap then lets it through, with no birth date anywhere.
    authState.userId = "user-undated";
    expect(
      await memoryPrivateIdentityStore.completeOnboarding({
        userId: "user-undated",
        handle: "undated_drinker",
      }),
    ).toMatchObject({ ok: true, privateIdentity: null });

    await expect(resolveContributionIdentity(request)).resolves.toMatchObject({
      ok: false,
      httpStatus: 409,
      body: { status: "adult_check_required", error: CONTRIBUTION_ADULT_REFUSAL },
    });

    await memoryAdultSelfAssertionStore.record("user-undated");
    await expect(resolveContributionIdentity(request)).resolves.toMatchObject({
      ok: true,
      accountId: "user-undated",
      handle: "undated_drinker",
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

  // THE HOLE F-6 FOUND. An account that told us it was born in 2012 had
  // ANSWERED, so `needsAdultSelfAssertion` was false and the old gate let it
  // through.
  it("refuses an account whose stored date of birth says under 18", async () => {
    authState.userId = "user-minor";
    expect(
      await memoryPrivateIdentityStore.completeOnboarding({
        userId: "user-minor",
        handle: "young_drinker",
        dateOfBirth: "2012-01-01",
      }),
    ).toMatchObject({ ok: true });

    await expect(resolveContributionIdentity(request)).resolves.toMatchObject({
      ok: false,
      httpStatus: 409,
      body: {
        status: "adult_check_failed",
        error: CONTRIBUTION_UNDER_18_REFUSAL,
      },
    });
  });

  // A TAP MAY NOT OVERTURN AN ANSWER THE ACCOUNT ALREADY GAVE (10 Aug rule).
  it("keeps refusing an under-18 account that has also tapped", async () => {
    authState.userId = "user-minor-tapped";
    expect(
      await memoryPrivateIdentityStore.completeOnboarding({
        userId: "user-minor-tapped",
        handle: "tapping_minor",
        dateOfBirth: "2012-01-01",
      }),
    ).toMatchObject({ ok: true });
    await memoryAdultSelfAssertionStore.record("user-minor-tapped");

    await expect(resolveContributionIdentity(request)).resolves.toMatchObject({
      ok: false,
      body: { status: "adult_check_failed" },
    });
  });

  // THE TWO DOORS ARE ONE DECISION. `contributionAdultRefusal` is the only
  // place the branch is chosen, and the photo door and the price door both
  // hand it the same two answers, so they cannot drift apart again.
  describe("the answer every contribution door gives", () => {
    const MINOR = { dateOfBirth: "2012-01-01", adultSelfAssertedAt: null };
    const SILENT = { dateOfBirth: null, adultSelfAssertedAt: null };
    const TAPPED = { dateOfBirth: null, adultSelfAssertedAt: "2026-09-05T12:00:00.000Z" };
    const GROWN = { dateOfBirth: "1990-01-01", adultSelfAssertedAt: null };

    function answer(evidence: {
      dateOfBirth: string | null;
      adultSelfAssertedAt: string | null;
    }) {
      return contributionAdultRefusal({
        isAdult: accountIsAdult(evidence),
        needsSelfAssertion: needsAdultSelfAssertion(evidence),
      });
    }

    it("refuses an under-18 stored date of birth with no tap behind it", () => {
      expect(answer(MINOR)).toEqual({
        status: "adult_check_failed",
        error: CONTRIBUTION_UNDER_18_REFUSAL,
      });
    });

    it("offers the tap only where the tap is the thing in the way", () => {
      expect(answer(SILENT)).toEqual({
        status: "adult_check_required",
        error: CONTRIBUTION_ADULT_REFUSAL,
      });
    });

    it("admits a recorded tap and an adult date of birth alike", () => {
      expect(answer(TAPPED)).toBeNull();
      expect(answer(GROWN)).toBeNull();
    });

    // The refusal has to describe the check that ran, or a stranger reads a
    // claim the code never made.
    it("words each refusal as the check that produced it", () => {
      expect(CONTRIBUTION_UNDER_18_REFUSAL).toMatch(/date of birth/i);
      expect(CONTRIBUTION_UNDER_18_REFUSAL).not.toMatch(/confirm/i);
      expect(CONTRIBUTION_ADULT_REFUSAL).toMatch(/confirm/i);
    });
  });
});
