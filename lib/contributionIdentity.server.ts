import { callerUserId } from "@/lib/authServer";
import { identityHandleStore } from "@/lib/identityHandleStore";
import { londonCalendarDate } from "@/lib/privateIdentity";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { profileStore } from "@/lib/profileStore";

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
        status?:
          | "sign_in_required"
          | "onboarding_required"
          | "age_assessment_required"
          | "age_restricted";
        error: string;
      };
      httpStatus: 401 | 403 | 409 | 503;
    };

export async function resolveContributionIdentity(
  request: Request,
): Promise<ContributionIdentityResolution> {
  const userId = await callerUserId(request);
  if (!userId) {
    return {
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    };
  }
  try {
    const [profile, privateIdentity] = await Promise.all([
      profileStore().getByUserId(userId),
      privateIdentityStore().read(userId),
    ]);
    if (!profile || !privateIdentity) {
      return {
        ok: false,
        accountId: userId,
        body: {
          status: "onboarding_required",
          error: "Choose your public handle before contributing.",
        },
        httpStatus: 409,
      };
    }
    if (
      !privateIdentity.adultConfirmed &&
      !privateIdentity.contributionEligibleFrom
    ) {
      return {
        ok: false,
        accountId: userId,
        body: {
          status: "age_assessment_required",
          error: "Confirm you are 18 or over before contributing.",
        },
        httpStatus: 409,
      };
    }
    if (
      privateIdentity.contributionEligibleFrom &&
      privateIdentity.contributionEligibleFrom > londonCalendarDate(Date.now())
    ) {
      return {
        ok: false,
        accountId: userId,
        body: {
          status: "age_restricted",
          error: `You cannot contribute while under 18. You can contribute from ${privateIdentity.contributionEligibleFrom}.`,
        },
        httpStatus: 403,
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
