import "server-only";

import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import { verifyCallerAuth } from "@/lib/authServer";
import {
  CONTRIBUTION_ADULT_REFUSAL,
  CONTRIBUTION_HANDLE_REFUSAL,
  type ContributionGateStatus,
} from "@/lib/contributionGateStatus";
import { identityHandleStore } from "@/lib/identityHandleStore";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { profileStore } from "@/lib/profileStore";
import { needsAdultSelfAssertion } from "@/lib/socialLaunch";

// The vocabulary is a pure leaf so the browser can read it too; every name is
// re-exported here, because this module is the one a reader reaches for.
export {
  CONTRIBUTION_ADULT_REFUSAL,
  CONTRIBUTION_GATE_STATUSES,
  CONTRIBUTION_HANDLE_REFUSAL,
  readContributionGateStatus,
} from "@/lib/contributionGateStatus";
export type { ContributionGateStatus } from "@/lib/contributionGateStatus";

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
        code?: "AUTH_VERIFICATION_UNAVAILABLE";
        error: string;
        retryable?: true;
      };
      httpStatus: 401 | 409 | 503;
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
    // THE 10 AUG RULE, ASKED HERE TOO. `needsAdultSelfAssertion` is true only
    // when the account has answered neither way, so the recorded one tap is
    // the age answer and a stored date of birth still decides where there is
    // one - this gate reads it the same way Social's does, and neither of them
    // is the place a stored date of birth is judged.
    if (
      needsAdultSelfAssertion({
        dateOfBirth: privateIdentity?.dateOfBirth ?? null,
        adultSelfAssertedAt,
      })
    ) {
      return {
        ok: false,
        accountId: userId,
        body: {
          status: "adult_check_required",
          error: CONTRIBUTION_ADULT_REFUSAL,
        },
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
