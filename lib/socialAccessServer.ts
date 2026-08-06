import { auth } from "@clerk/nextjs/server";

import type { CallerAuthVerification } from "@/lib/authServer";
import { isClerkMiddlewareConfigured } from "@/lib/clerkIdentity";
import {
  decideSocialAccess,
  isSocialInviteBetaEnabled,
  SOCIAL_BETA_DISABLED,
  type SocialAdultVerification,
  type SocialAccessState,
  type SocialProductAccount,
} from "@/lib/socialAccess";
import { requireSupabaseAdmin } from "@/lib/supabase";

type ClerkSessionVerification =
  | { status: "absent" }
  | { status: "unavailable" }
  | { status: "verified"; userId: string };

type AccountAccessRecord = {
  account: SocialProductAccount | null;
  verification: SocialAdultVerification | null;
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

export type SocialAccessServerDependencies = {
  betaEnabled: boolean;
  now: () => Date;
  verifyClerkSession: () => Promise<ClerkSessionVerification>;
  readAccountAccess: (clerkUserId: string) => Promise<AccountAccessRecord>;
  migrateAccounts: (
    input: AccountMigrationInput,
  ) => Promise<AccountMigrationStoreResult>;
};

export type SocialAccessResolution =
  | { available: true; state: SocialAccessState }
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
    .select("id,clerk_user_id,ownership_state")
    .eq("clerk_user_id", clerkUserId)
    .limit(1);
  if (accountError) throw new Error(accountError.message);
  const accountRow = rowObject((accountRows ?? [])[0]);
  if (!accountRow) return { account: null, verification: null };
  if (
    typeof accountRow.id !== "string" ||
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
  if (!verificationRow) return { account, verification: null };
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
  return { account, verification };
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

const defaultDependencies: SocialAccessServerDependencies = {
  betaEnabled: isSocialInviteBetaEnabled(
    process.env.SOCIAL_INVITE_BETA_ENABLED,
  ),
  now: () => new Date(),
  verifyClerkSession,
  readAccountAccess,
  migrateAccounts,
};

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
  dependencies: SocialAccessServerDependencies = defaultDependencies,
): Promise<SocialAccessResolution> {
  if (!dependencies.betaEnabled) {
    return { available: true, state: "preview" };
  }
  const clerk = await dependencies.verifyClerkSession();
  if (clerk.status === "unavailable") return unavailableAccess();
  if (clerk.status === "absent") {
    return { available: true, state: "sign_in_required" };
  }
  try {
    const { account, verification } = await dependencies.readAccountAccess(
      clerk.userId,
    );
    return {
      available: true,
      state: decideSocialAccess({
        betaEnabled: true,
        clerkUserId: clerk.userId,
        account,
        verification,
        now: dependencies.now(),
      }),
    };
  } catch {
    return unavailableAccess();
  }
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
  dependencies: SocialAccessServerDependencies = defaultDependencies,
): Promise<SocialAccountMigrationResolution> {
  if (!dependencies.betaEnabled) {
    return SOCIAL_BETA_DISABLED;
  }
  const clerk = await dependencies.verifyClerkSession();
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

  const result = await dependencies.migrateAccounts({
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
