import "server-only";

import { needsAdultSelfAssertion } from "@/lib/adultGate";
import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import type { ContributionDoorStatus } from "@/lib/contributionGateStatus";
import {
  authReadCredentialFromHeader,
  verifyAuthReadCredential,
} from "@/lib/authReadCredential.server";
import { verifyCallerAuth } from "@/lib/authServer";
import {
  decideFriendsLaunchSocialAccess,
  type SocialAccessState,
  type SocialProductAccount,
} from "@/lib/socialAccess";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
} from "@/lib/socialLaunch";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { requireSupabaseAdmin } from "@/lib/supabase";

type SupabaseSessionVerification =
  | { status: "absent" }
  | { status: "unavailable" }
  | { status: "verified"; userId: string };

type FriendsLaunchAccessRecord = {
  account: SocialProductAccount | null;
  profile: { id: string; handle: string } | null;
  dateOfBirth: string | null;
  /** Recorded one-tap assertion (migration 0103), or null. */
  adultSelfAssertedAt?: string | null;
};

type ProvisionStoreResult =
  | { ok: true; productAccountId: string; provisioned: boolean }
  | {
      ok: false;
      reason:
        | "profile_not_claimed"
        | "ownership_conflict"
        | "invalid"
        | "storage";
    };

export type SocialAccessServerDependencies = {
  friendsLaunchEnabled: boolean;
  now: () => Date;
  verifySupabaseSession: (request?: Request) => Promise<SupabaseSessionVerification>;
  readFriendsLaunchAccess: (supabaseUserId: string) => Promise<FriendsLaunchAccessRecord>;
};

export type SocialAccessResolution =
  | {
      available: true;
      state: Exclude<SocialAccessState, "verified">;
      /**
       * True only when the one tap is the way through: the account has neither
       * a stored date of birth nor a recorded assertion. A stored date of birth
       * that says under 18 leaves this false, so the surface never offers a
       * button that would not be honoured.
       */
      adultPrompt?: boolean;
      gate?: ContributionDoorStatus;
    }
  | { available: true; state: "verified"; actor: SocialPostActor }
  | {
      available: false;
      state: "preview";
      code: "SOCIAL_ACCESS_UNAVAILABLE";
      error: string;
      retryable: true;
    };

// An <img> request carries no bearer. This lane authenticates it by the
// signed read credential instead: /api/auth/session mints the credential when
// it verifies the session, and verifying the HMAC here never touches GoTrue.
// That is the whole point — the resume cookie's refresh token and the
// browser's stored token are one chain, and a lane that spent the cookie's
// copy could not write the successor back, so two owners spent one token and
// GoTrue's reuse rule could revoke the session (#3114). Now the refresh token
// has exactly one owner, and ambient reads borrow a proof, not the token.
//
// THE COOKIE IS AN AMBIENT CREDENTIAL, SO IT ONLY READS. The browser attaches
// it to every same-site request, and a minted credential outlives a revocation
// by its remaining TTL. The lane exists for GET media an `<img>` asks for, so
// a write (post, comment, cheer, crew, ranking, tag) must carry a bearer that
// GoTrue checks on every request (October 2026 security audit).
const RESUME_COOKIE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

async function verifySupabaseSessionFromRequest(
  request?: Request,
): Promise<SupabaseSessionVerification> {
  if (!request) return { status: "absent" };
  const bearer = await verifyCallerAuth(request);
  if (bearer.status === "verified") {
    return { status: "verified", userId: bearer.identity.id };
  }
  if (bearer.status === "unavailable") return { status: "unavailable" };
  if (!RESUME_COOKIE_METHODS.has(request.method.toUpperCase())) {
    return { status: "absent" };
  }
  // A bearer GoTrue has just called banned outranks an ambient credential
  // minted before the ban.
  if (bearer.status === "banned") return { status: "absent" };

  const credential = authReadCredentialFromHeader(request.headers.get("cookie"));
  if (!credential) return { status: "absent" };
  const userId = verifyAuthReadCredential(credential);
  return userId ? { status: "verified", userId } : { status: "absent" };
}

function rowObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function provisionSocialAccount(
  supabaseUserId: string,
): Promise<ProvisionStoreResult> {
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "provision_social_product_account",
      { p_supabase_user_id: supabaseUserId },
    );
    if (error) return { ok: false, reason: "storage" };
    const result = rowObject(Array.isArray(data) ? data[0] : data);
    if (result?.ok === true && typeof result.product_account_id === "string") {
      return {
        ok: true,
        productAccountId: result.product_account_id,
        provisioned: result.provisioned === true,
      };
    }
    return {
      ok: false,
      reason:
        result?.code === "profile_not_claimed"
          ? "profile_not_claimed"
          : result?.code === "ownership_conflict"
            ? "ownership_conflict"
            : result?.code === "invalid"
              ? "invalid"
              : "storage",
    };
  } catch {
    return { ok: false, reason: "storage" };
  }
}

async function readFriendsLaunchAccess(
  supabaseUserId: string,
): Promise<FriendsLaunchAccessRecord> {
  const provision = await provisionSocialAccount(supabaseUserId);
  if (!provision.ok) {
    if (provision.reason === "profile_not_claimed") {
      return { account: null, profile: null, dateOfBirth: null };
    }
    throw new Error("Invalid Social friends-launch account state.");
  }

  const admin = requireSupabaseAdmin();
  const { data: accountRows, error: accountError } = await admin
    .from("private_social_accounts")
    .select("id,clerk_user_id,profile_id,ownership_state")
    .eq("id", provision.productAccountId)
    .limit(1);
  if (accountError) throw new Error(accountError.message);
  const accountRow = rowObject((accountRows ?? [])[0]);
  if (
    !accountRow ||
    typeof accountRow.id !== "string" ||
    typeof accountRow.profile_id !== "string" ||
    typeof accountRow.clerk_user_id !== "string" ||
    !["active", "suspended"].includes(String(accountRow.ownership_state))
  ) {
    throw new Error("Invalid Social account state.");
  }

  const account: SocialProductAccount = {
    id: accountRow.id,
    ownershipState:
      accountRow.ownership_state === "suspended" ? "suspended" : "active",
  };

  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .select("id,handle,user_id")
    .eq("id", accountRow.profile_id)
    .limit(1);
  if (profileError) throw new Error(profileError.message);
  const profileRow = rowObject((profileRows ?? [])[0]);
  if (
    !profileRow ||
    profileRow.id !== accountRow.profile_id ||
    profileRow.user_id !== supabaseUserId ||
    typeof profileRow.handle !== "string" ||
    !profileRow.handle.trim()
  ) {
    throw new Error("Invalid Social profile ownership state.");
  }
  const profile = {
    id: profileRow.id as string,
    handle: profileRow.handle.trim(),
  };

  const { data: identityRows, error: identityError } = await admin
    .from("private_account_identities")
    .select("date_of_birth")
    .eq("user_id", supabaseUserId)
    .limit(1);
  if (identityError) throw new Error(identityError.message);
  const identityRow = rowObject((identityRows ?? [])[0]);
  const rawDob = identityRow?.date_of_birth;
  const dateOfBirth =
    typeof rawDob === "string" && rawDob.trim() ? rawDob.trim() : null;

  // The second half of the age answer. An account claimed through the early
  // handle path has no identity row at all, so this is the lane it comes in by.
  const adultSelfAssertedAt = await adultSelfAssertionStore().read(
    supabaseUserId,
  );

  return { account, profile, dateOfBirth, adultSelfAssertedAt };
}

function readDefaultDependencies(
  env: Record<string, string | undefined> = process.env,
): SocialAccessServerDependencies {
  return {
    friendsLaunchEnabled: isSocialFriendsLaunchEnabled(
      env[SOCIAL_FRIENDS_LAUNCH_ENV],
    ),
    now: () => new Date(),
    verifySupabaseSession: verifySupabaseSessionFromRequest,
    readFriendsLaunchAccess,
  };
}

function unavailableAccess(): SocialAccessResolution {
  return {
    available: false,
    state: "preview",
    code: "SOCIAL_ACCESS_UNAVAILABLE",
    error: "Social access checks are unavailable right now.",
    retryable: true,
  };
}

export async function resolveSocialAccess(
  request?: Request,
  dependencies?: SocialAccessServerDependencies,
): Promise<SocialAccessResolution> {
  return (await resolveSocialAccessFor(request, dependencies)).access;
}

// The resolution plus, when the state is verified, the auth user id the
// session verified. That id stays on the server: the access route hands the
// resolution to the browser, and its shape does not change.
async function resolveSocialAccessFor(
  request?: Request,
  dependencies?: SocialAccessServerDependencies,
): Promise<{ access: SocialAccessResolution; authUserId: string | null }> {
  const deps = dependencies ?? readDefaultDependencies();
  const without = (access: SocialAccessResolution) => ({ access, authUserId: null });
  if (!deps.friendsLaunchEnabled) return without({ available: true, state: "preview" });
  const supabase = await deps.verifySupabaseSession(request);
  if (supabase.status === "unavailable") return without(unavailableAccess());
  if (supabase.status === "absent") {
    return without({ available: true, state: "sign_in_required" });
  }
  try {
    const { account, profile, dateOfBirth, adultSelfAssertedAt } =
      await deps.readFriendsLaunchAccess(supabase.userId);
    const state = decideFriendsLaunchSocialAccess({
      friendsLaunchEnabled: deps.friendsLaunchEnabled,
      supabaseUserId: supabase.userId,
      claimedHandle: profile?.handle ?? null,
      dateOfBirth,
      adultSelfAssertedAt: adultSelfAssertedAt ?? null,
      ownershipState: account?.ownershipState ?? null,
      now: deps.now(),
    });
    if (state === "verified") {
      if (!account || !profile || account.id === "" || profile.id === "" || profile.handle === "") {
        return without(unavailableAccess());
      }
      return {
        access: {
          available: true,
          state,
          actor: { accountId: account.id, profileId: profile.id, handle: profile.handle },
        },
        authUserId: supabase.userId,
      };
    }
    const gate: ContributionDoorStatus = !profile?.handle?.trim()
      ? "onboarding_required"
      : needsAdultSelfAssertion({ dateOfBirth, adultSelfAssertedAt: adultSelfAssertedAt ?? null })
        ? "adult_check_required"
        : "adult_check_failed";
    return without({
      available: true,
      state,
      ...(state === "age_verification_required"
        ? {
            gate,
            adultPrompt: gate === "adult_check_required",
          }
        : {}),
    });
  } catch {
    return without(unavailableAccess());
  }
}

export type VerifiedSocialActorResolution =
  | {
      ok: true;
      actor: SocialPostActor;
      /**
       * The auth user id this session verified (`profiles.user_id`). It is a
       * different domain from `actor.accountId`, the private Social account
       * record's own id, which provisioning gives a UUID of its own. A check
       * that reads the auth owner, such as handle ownership through
       * `identityHandleStore().ownedHandle`, takes this one.
       */
      authUserId: string;
    }
  | {
      ok: false;
      status: 401 | 403 | 503;
      code:
        | "SOCIAL_SIGN_IN_REQUIRED"
        | "SOCIAL_ADULT_VERIFICATION_REQUIRED"
        | "SOCIAL_ACCOUNT_SUSPENDED"
        | "SOCIAL_ACCESS_UNAVAILABLE";
      error: string;
      retryable?: true;
      gate?: ContributionDoorStatus;
    };

export async function requireVerifiedSocialActor(
  request?: Request,
  dependencies?: SocialAccessServerDependencies,
): Promise<VerifiedSocialActorResolution> {
  const deps = dependencies ?? readDefaultDependencies();
  const { access, authUserId } = await resolveSocialAccessFor(request, deps);
  if (!access.available) {
    return {
      ok: false,
      status: 503,
      code: access.code,
      error: access.error,
      retryable: true,
    };
  }
  if (access.state === "verified" && authUserId) {
    return { ok: true, actor: access.actor, authUserId };
  }
  if (access.state === "verified") {
    return {
      ok: false,
      status: 503,
      code: "SOCIAL_ACCESS_UNAVAILABLE",
      error: "Social access checks are unavailable right now.",
      retryable: true,
    };
  }
  if (access.state === "preview") {
    return { ok: false, status: 503, code: "SOCIAL_ACCESS_UNAVAILABLE", error: "Social is not open yet." };
  }
  if (access.state === "sign_in_required") {
    return { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." };
  }
  if (access.state === "suspended") {
    return { ok: false, status: 403, code: "SOCIAL_ACCOUNT_SUSPENDED", error: "Social access is suspended." };
  }
  return {
    ok: false,
    status: 403,
    code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
    error: "Adult verification is needed for Social.",
    gate: access.gate,
  };
}
