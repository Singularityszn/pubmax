import { callerUserId } from "@/lib/authServer";
import { identityHandleStore } from "@/lib/identityHandleStore";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { profileStore } from "@/lib/profileStore";

export type ContributionIdentityResolution =
  | {
      ok: true;
      actor: string;
      handle: string;
    }
  | {
      ok: false;
      body: {
        status?: "sign_in_required" | "onboarding_required" | "age_required" | "underage";
        eligibleOn?: string;
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
    const [profile, gate] = await Promise.all([
      profileStore().getByUserId(userId),
      privateIdentityStore().contributionGate(userId),
    ]);
    if (!profile || gate.status === "onboarding_required") {
      return {
        ok: false,
        body: {
          status: "onboarding_required",
          error: "Choose your public handle before contributing.",
        },
        httpStatus: 409,
      };
    }
    if (gate.status === "age_required") {
      return {
        ok: false,
        body: {
          status: gate.status,
          error:
            "Confirm you are 18 or over before your first gated contribution.",
        },
        httpStatus: 403,
      };
    }
    if (gate.status === "underage") {
      return {
        ok: false,
        body: {
          ...gate,
          error:
            "You must be 18 or over to contribute. PUBMAXX is about buying alcohol.",
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
      actor: `profile:${profile.id}`,
      handle,
    };
  } catch {
    return {
      ok: false,
      body: { error: "Contribution eligibility is unavailable right now." },
      httpStatus: 503,
    };
  }
}
