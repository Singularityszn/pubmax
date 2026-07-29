import { callerUserId } from "@/lib/authServer";
import { identityHandleStore } from "@/lib/identityHandleStore";
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
        status?: "sign_in_required" | "onboarding_required";
        error: string;
      };
      httpStatus: 401 | 409 | 503;
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
    if (!profile || !privateIdentity?.dateOfBirth) {
      return {
        ok: false,
        accountId: userId,
        body: {
          status: "onboarding_required",
          error: "Finish your public handle and private profile before contributing.",
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
