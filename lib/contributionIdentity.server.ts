import "server-only";

import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import { AUTH_ACCOUNT_BANNED_MESSAGE } from "@/lib/authAccountBan";
import { verifyCallerAuth } from "@/lib/authServer";
import {
  contributionAdultRefusal,
  CONTRIBUTION_HANDLE_REFUSAL,
  type ContributionGateStatus,
} from "@/lib/contributionGateStatus";
import { identityHandleStore } from "@/lib/identityHandleStore";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { profileStore } from "@/lib/profileStore";
import { accountIsAdult, needsAdultSelfAssertion } from "@/lib/adultGate";

// The vocabulary is a pure leaf so the browser can read it too; every name is
// re-exported here, because this module is the one a reader reaches for.
export {
  contributionAdultRefusal,
  CONTRIBUTION_ADULT_REFUSAL,
  CONTRIBUTION_HANDLE_REFUSAL,
  CONTRIBUTION_UNDER_18_REFUSAL,
} from "@/lib/contributionGateStatus";

export type ContributionIdentityResolution =
  | {
      ok: true;
      accountId: string;
      actor: string;
      handle: string;
    }
  | {
      ok: false;
      accountId?: string;
      body: {
        status?: ContributionGateStatus;
        code?: "AUTH_VERIFICATION_UNAVAILABLE" | "ACCOUNT_BANNED";
        error: string;
        retryable?: true;
      };
      httpStatus: 401 | 403 | 409 | 503;
    };

export async function resolveContributionIdentity(
  request: Request,
): Promise<ContributionIdentityResolution> {
  const verification = await verifyCallerAuth(request);
  if (
    verification.status === "absent" ||
    verification.status === "invalid"
  ) {
    return {
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    };
  }
  if (verification.status === "unavailable") {
    return {
      ok: false,
      body: {
        code: "AUTH_VERIFICATION_UNAVAILABLE",
        error: "Sign-in verification is unavailable right now. Try again.",
        retryable: true,
      },
      httpStatus: 503,
    };
  }
  if (verification.status === "banned") {
    return {
      ok: false,
      body: {
        code: "ACCOUNT_BANNED",
        error: AUTH_ACCOUNT_BANNED_MESSAGE,
      },
      httpStatus: 403,
    };
  }
  const userId = verification.identity.id;
  try {
    const [profile, privateIdentity, adultSelfAssertedAt] = await Promise.all([
      profileStore().getByUserId(userId),
      privateIdentityStore().read(userId),
      adultSelfAssertionStore().read(userId),
    ]);
    if (!profile) {
      return {
        ok: false,
        accountId: userId,
        body: {
          status: "onboarding_required",
          error: CONTRIBUTION_HANDLE_REFUSAL,
        },
        httpStatus: 409,
      };
    }
    // THE 10 AUG RULE, ASKED HERE THE WAY THE PHOTO WALL ASKS IT. `accountIsAdult`
    // is the ONE adult gate and it is what judges the age: a stored date of
    // birth decides in BOTH directions, and only where there is none does the
    // recorded one tap answer. Asking `needsAdultSelfAssertion` alone was the
    // hole - it is true only when NOBODY has answered, so an account that told
    // us it was 15 walked through the price door while the pub photo wall next
    // to it refused the same account.
    //
    // `needsAdultSelfAssertion` is still asked, for the one thing it says: is a
    // tap the ACTUAL thing in the way. That is what picks the refusal, so the
    // sentence a reader gets names the check that ran.
    const adultEvidence = {
      dateOfBirth: privateIdentity?.dateOfBirth ?? null,
      adultSelfAssertedAt,
    };
    const adultRefusal = contributionAdultRefusal({
      isAdult: accountIsAdult(adultEvidence),
      needsSelfAssertion: needsAdultSelfAssertion(adultEvidence),
    });
    if (adultRefusal) {
      return {
        ok: false,
        accountId: userId,
        body: adultRefusal,
        httpStatus: 409,
      };
    }
    const handleResolution = await identityHandleStore().resolve(profile.handle);
    const handle =
      handleResolution?.profileId === profile.id
        ? handleResolution.currentHandle
        : profile.handle;
    return {
      ok: true,
      accountId: userId,
      actor: `profile:${profile.id}`,
      handle,
    };
  } catch {
    return {
      ok: false,
      accountId: userId,
      body: { error: "Contribution identity is unavailable right now." },
      httpStatus: 503,
    };
  }
}
