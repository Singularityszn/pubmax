import "server-only";

import { auth } from "@clerk/nextjs/server";

import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import type { CallerAuthVerification } from "@/lib/authServer";
import { verifyCallerAuth } from "@/lib/authServer";
import {
  authResumeCookieFromHeader,
  decodeAuthResumeCookie,
} from "@/lib/authSessionResume";
import { isClerkMiddlewareConfigured } from "@/lib/clerkIdentity";
import {
  decideFriendsLaunchSocialAccess,
  decideSocialAccess,
  isSocialInviteBetaEnabled,
  SOCIAL_BETA_DISABLED,
  type SocialAdultVerification,
  type SocialAccessState,
  type SocialProductAccount,
} from "@/lib/socialAccess";
import {
  isSocialFriendsLaunchEnabled,
  needsAdultSelfAssertion,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  socialSurfaceName,
} from "@/lib/socialLaunch";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { requireSupabaseAdmin } from "@/lib/supabase";

type ClerkSessionVerification =
  | { status: "absent" }
  | { status: "unavailable" }
  | { status: "verified"; userId: string };

type SupabaseSessionVerification =
  | { status: "absent" }
  | { status: "unavailable" }
  | { status: "verified"; userId: string };

type AccountAccessRecord = {
  account: SocialProductAccount | null;
  profile: { id: string; handle: string } | null;
  verification: SocialAdultVerification | null;
};

type FriendsLaunchAccessRecord = {
  account: SocialProductAccount | null;
  profile: { id: string; handle: string } | null;
  dateOfBirth: string | null;
  /** Recorded one-tap assertion (migration 0103), or null. */
  adultSelfAssertedAt?: string | null;
};

type AccountMigrationInput = {
  clerkUserId: string;
  supabaseUserId: string;
};

type AccountMigrationStoreResult =
  | { ok: true; productAccountId: string; migrated: boolean }
  | {
      ok: false;
      reason: "legacy_profile_not_found" | "ownership_conflict" | "storage";
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
  betaEnabled: boolean;
  now: () => Date;
  verifyClerkSession: () => Promise<ClerkSessionVerification>;
  verifySupabaseSession: (request?: Request) => Promise<SupabaseSessionVerification>;
  readAccountAccess: (clerkUserId: string) => Promise<AccountAccessRecord>;
  readFriendsLaunchAccess: (supabaseUserId: string) => Promise<FriendsLaunchAccessRecord>;
  migrateAccounts: (
    input: AccountMigrationInput,
  ) => Promise<AccountMigrationStoreResult>;
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
    }
  | { available: true; state: "verified"; actor: SocialPostActor }
  | {
      available: false;
      state: "preview";
      code: "SOCIAL_ACCESS_UNAVAILABLE";
      error: string;
      retryable: true;
    };

export type SocialAccountMigrationResolution =
  | { ok: true; productAccountId: string; migrated: boolean }
  | {
      ok: false;
      status: 401 | 403 | 409 | 503;
      code:
        | "BOTH_SESSIONS_REQUIRED"
        | "SOCIAL_BETA_DISABLED"
        | "LEGACY_ACCOUNT_NOT_FOUND"
        | "ACCOUNT_OWNERSHIP_CONFLICT"
        | "ACCOUNT_MIGRATION_UNAVAILABLE";
      error: string;
      retryable?: true;
    };

const GOTRUE_TIMEOUT_MS = 10_000;

function supabaseAuthConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

async function verifyClerkSession(): Promise<ClerkSessionVerification> {
  if (!isClerkMiddlewareConfigured()) return { status: "unavailable" };
  try {
    const session = await auth();
    return session.userId
      ? { status: "verified", userId: session.userId }
      : { status: "absent" };
  } catch {
    return { status: "unavailable" };
  }
}

async function verifySupabaseSessionFromRequest(
  request?: Request,
): Promise<SupabaseSessionVerification> {
  if (request) {
    const bearer = await verifyCallerAuth(request);
    if (bearer.status === "verified") {
      return { status: "verified", userId: bearer.identity.id };
    }
    if (bearer.status === "unavailable") return { status: "unavailable" };
  }
  if (!request) return { status: "absent" };

  const payload = decodeAuthResumeCookie(
    authResumeCookieFromHeader(request.headers.get("cookie")),
  );
  if (!payload?.refreshToken) return { status: "absent" };

  const config = supabaseAuthConfig();
  if (!config) return { status: "unavailable" };

  try {
    const response = await fetch(
      new URL("/auth/v1/token?grant_type=refresh_token", config.url),
      {
        method: "POST",
        headers: {
          apikey: config.key,
          "content-type": "application/json",
        },
        body: JSON.stringify({ refresh_token: payload.refreshToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(GOTRUE_TIMEOUT_MS),
      },
    );
    if (!response.ok) return { status: "absent" };
    const session = (await response.json()) as Record<string, unknown>;
    const user =
      session.user && typeof session.user === "object"
        ? (session.user as Record<string, unknown>)
        : null;
    const userId = user && typeof user.id === "string" ? user.id : null;
    if (!userId) return { status: "unavailable" };
    return { status: "verified", userId };
  } catch {
    return { status: "unavailable" };
  }
}

function rowObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readAccountAccess(
  clerkUserId: string,
): Promise<AccountAccessRecord> {
  const admin = requireSupabaseAdmin();
  const { data: accountRows, error: accountError } = await admin
    .from("private_social_accounts")
    .select("id,clerk_user_id,profile_id,ownership_state")
    .eq("clerk_user_id", clerkUserId)
    .limit(1);
  if (accountError) throw new Error(accountError.message);
  const accountRow = rowObject((accountRows ?? [])[0]);
  if (!accountRow) return { account: null, profile: null, verification: null };
  if (
    typeof accountRow.id !== "string" ||
    typeof accountRow.profile_id !== "string" ||
    accountRow.clerk_user_id !== clerkUserId ||
    !["active", "suspended"].includes(String(accountRow.ownership_state))
  ) {
    throw new Error("Invalid Social account state.");
  }

  const account: SocialProductAccount = {
    id: accountRow.id,
    clerkUserId,
    ownershipState:
      accountRow.ownership_state === "suspended" ? "suspended" : "active",
  };
  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .select("id,handle")
    .eq("id", accountRow.profile_id)
    .limit(1);
  if (profileError) throw new Error(profileError.message);
  const profileRow = rowObject((profileRows ?? [])[0]);
  if (
    !profileRow || profileRow.id !== accountRow.profile_id ||
    typeof profileRow.handle !== "string" || !profileRow.handle.trim()
  ) throw new Error("Invalid Social profile ownership state.");
  const profile = { id: profileRow.id as string, handle: profileRow.handle.trim() };
  const { data: verificationRows, error: verificationError } = await admin
    .from("private_social_age_verifications")
    .select(
      "product_account_id,provider,decision,verified_at,expires_at,audit_state",
    )
    .eq("product_account_id", account.id)
    .eq("audit_state", "current")
    .order("verified_at", { ascending: false })
    .limit(1);
  if (verificationError) throw new Error(verificationError.message);
  const verificationRow = rowObject((verificationRows ?? [])[0]);
  if (!verificationRow) return { account, profile, verification: null };
  if (
    verificationRow.product_account_id !== account.id ||
    verificationRow.provider !== "yoti" ||
    verificationRow.audit_state !== "current" ||
    !["verified_adult", "not_verified"].includes(
      String(verificationRow.decision),
    ) ||
    typeof verificationRow.verified_at !== "string" ||
    typeof verificationRow.expires_at !== "string"
  ) {
    throw new Error("Invalid Social adult assurance state.");
  }

  const verification: SocialAdultVerification = {
    productAccountId: account.id,
    provider: "yoti",
    decision:
      verificationRow.decision === "verified_adult"
        ? "verified_adult"
        : "not_verified",
    auditState: "current",
    verifiedAt: verificationRow.verified_at,
    expiresAt: verificationRow.expires_at,
  };
  return { account, profile, verification };
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
    clerkUserId: accountRow.clerk_user_id,
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

async function migrateAccounts(
  input: AccountMigrationInput,
): Promise<AccountMigrationStoreResult> {
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "migrate_social_product_account",
      {
        p_clerk_user_id: input.clerkUserId,
        p_supabase_user_id: input.supabaseUserId,
      },
    );
    if (error) return { ok: false, reason: "storage" };
    const result = rowObject(Array.isArray(data) ? data[0] : data);
    if (result?.ok === true && typeof result.product_account_id === "string") {
      return {
        ok: true,
        productAccountId: result.product_account_id,
        migrated: result.migrated === true,
      };
    }
    return {
      ok: false,
      reason:
        result?.code === "legacy_profile_not_found"
          ? "legacy_profile_not_found"
          : result?.code === "ownership_conflict"
            ? "ownership_conflict"
            : "storage",
    };
  } catch {
    return { ok: false, reason: "storage" };
  }
}

function readDefaultDependencies(
  env: Record<string, string | undefined> = process.env,
): SocialAccessServerDependencies {
  return {
    friendsLaunchEnabled: isSocialFriendsLaunchEnabled(
      env[SOCIAL_FRIENDS_LAUNCH_ENV],
    ),
    betaEnabled: isSocialInviteBetaEnabled(env.SOCIAL_INVITE_BETA_ENABLED),
    now: () => new Date(),
    verifyClerkSession,
    verifySupabaseSession: verifySupabaseSessionFromRequest,
    readAccountAccess,
    readFriendsLaunchAccess,
    migrateAccounts,
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
  const deps = dependencies ?? readDefaultDependencies();
  if (deps.friendsLaunchEnabled) {
    const supabase = await deps.verifySupabaseSession(request);
    if (supabase.status === "unavailable") return unavailableAccess();
    if (supabase.status === "absent") {
      return { available: true, state: "sign_in_required" };
    }
    try {
      const { account, profile, dateOfBirth, adultSelfAssertedAt } =
        await deps.readFriendsLaunchAccess(supabase.userId);
      const state = decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: supabase.userId,
        claimedHandle: profile?.handle ?? null,
        dateOfBirth,
        adultSelfAssertedAt: adultSelfAssertedAt ?? null,
        ownershipState: account?.ownershipState ?? null,
        now: deps.now(),
      });
      if (state === "verified") {
        if (
          !account ||
          !profile ||
          account.id === "" ||
          profile.id === "" ||
          profile.handle === ""
        ) {
          return unavailableAccess();
        }
        return {
          available: true,
          state,
          actor: {
            accountId: account.id,
            profileId: profile.id,
            handle: profile.handle,
          },
        };
      }
      return {
        available: true,
        state,
        // The tap is offered only when the age question is the ACTUAL thing in
        // the way. An account with no claimed handle shares this state, and a
        // button that recorded a true assertion and still refused entry would
        // read as broken; that account is met by the claim surface instead.
        ...(state === "age_verification_required"
          ? {
              adultPrompt:
                Boolean(profile?.handle?.trim()) &&
                needsAdultSelfAssertion({
                  dateOfBirth,
                  adultSelfAssertedAt: adultSelfAssertedAt ?? null,
                }),
            }
          : {}),
      };
    } catch {
      return unavailableAccess();
    }
  }

  if (!deps.betaEnabled) {
    return { available: true, state: "preview" };
  }
  const clerk = await deps.verifyClerkSession();
  if (clerk.status === "unavailable") return unavailableAccess();
  if (clerk.status === "absent") {
    return { available: true, state: "sign_in_required" };
  }
  try {
    const { account, profile, verification } = await deps.readAccountAccess(
      clerk.userId,
    );
    const state = decideSocialAccess({
      betaEnabled: true,
      clerkUserId: clerk.userId,
      account,
      verification,
      now: deps.now(),
    });
    if (state === "verified") {
      if (!account || !profile || account.id === "" || profile.id === "" || profile.handle === "") {
        return unavailableAccess();
      }
      return {
        available: true,
        state,
        actor: { accountId: account.id, profileId: profile.id, handle: profile.handle },
      };
    }
    return {
      available: true,
      state,
    };
  } catch {
    return unavailableAccess();
  }
}

export type VerifiedSocialActorResolution =
  | { ok: true; actor: SocialPostActor }
  | {
      ok: false;
      status: 401 | 403 | 503;
      code:
        | "SOCIAL_BETA_DISABLED"
        | "SOCIAL_SIGN_IN_REQUIRED"
        | "SOCIAL_ADULT_VERIFICATION_REQUIRED"
        | "SOCIAL_ACCOUNT_SUSPENDED"
        | "SOCIAL_ACCESS_UNAVAILABLE";
      error: string;
      retryable?: true;
    };

export async function requireVerifiedSocialActor(
  request?: Request,
  dependencies?: SocialAccessServerDependencies,
): Promise<VerifiedSocialActorResolution> {
  const deps = dependencies ?? readDefaultDependencies();
  const access = await resolveSocialAccess(request, deps);
  if (!access.available) {
    return {
      ok: false,
      status: 503,
      code: access.code,
      error: access.error,
      retryable: true,
    };
  }
  if (access.state === "verified") return { ok: true, actor: access.actor };
  const surface = socialSurfaceName(deps.friendsLaunchEnabled);
  if (access.state === "preview") {
    return { ok: false, status: 403, code: "SOCIAL_BETA_DISABLED", error: `${surface} is not open yet.` };
  }
  if (access.state === "sign_in_required") {
    return { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: `Sign in to use ${surface}.` };
  }
  if (access.state === "suspended") {
    return { ok: false, status: 403, code: "SOCIAL_ACCOUNT_SUSPENDED", error: `${surface} access is suspended.` };
  }
  return {
    ok: false,
    status: 403,
    code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
    error: `Adult verification is needed for ${surface}.`,
  };
}

function unavailableMigration(): SocialAccountMigrationResolution {
  return {
    ok: false,
    status: 503,
    code: "ACCOUNT_MIGRATION_UNAVAILABLE",
    error: "Account migration is unavailable right now.",
    retryable: true,
  };
}

export async function migrateSocialProductAccount(
  supabase: CallerAuthVerification,
  dependencies?: SocialAccessServerDependencies,
): Promise<SocialAccountMigrationResolution> {
  const deps = dependencies ?? readDefaultDependencies();
  if (!deps.betaEnabled) {
    return SOCIAL_BETA_DISABLED;
  }
  const clerk = await deps.verifyClerkSession();
  if (clerk.status === "unavailable" || supabase.status === "unavailable") {
    return unavailableMigration();
  }
  if (clerk.status !== "verified" || supabase.status !== "verified") {
    return {
      ok: false,
      status: 401,
      code: "BOTH_SESSIONS_REQUIRED",
      error: "Sign in with both accounts to move your existing PUBMAX account.",
    };
  }

  const result = await deps.migrateAccounts({
    clerkUserId: clerk.userId,
    supabaseUserId: supabase.identity.id,
  });
  if (result.ok) return result;
  if (result.reason === "legacy_profile_not_found") {
    return {
      ok: false,
      status: 409,
      code: "LEGACY_ACCOUNT_NOT_FOUND",
      error: "No existing PUBMAX account belongs to that legacy sign-in.",
    };
  }
  if (result.reason === "ownership_conflict") {
    return {
      ok: false,
      status: 409,
      code: "ACCOUNT_OWNERSHIP_CONFLICT",
      error: "Those sign-in accounts already belong to different PUBMAX accounts.",
    };
  }
  return unavailableMigration();
}

export { provisionSocialAccount, readDefaultDependencies };
