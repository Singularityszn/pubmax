import { describe, expect, it, vi } from "vitest";

import {
  migrateSocialProductAccount,
  resolveSocialAccess,
  type SocialAccessServerDependencies,
} from "@/lib/socialAccessServer";

const verifiedSupabase = {
  status: "verified" as const,
  identity: {
    id: "44444444-4444-4444-8444-444444444444",
    email: null,
    createdAt: null,
  },
};

function dependencies(
  overrides: Partial<SocialAccessServerDependencies> = {},
): SocialAccessServerDependencies {
  return {
    betaEnabled: true,
    now: () => new Date("2026-08-05T20:00:00.000Z"),
    verifyClerkSession: async () => ({ status: "verified", userId: "clerk-1" }),
    readAccountAccess: async () => ({
      account: {
        id: "account-1",
        clerkUserId: "clerk-1",
        ownershipState: "active",
      },
      verification: {
        productAccountId: "account-1",
        provider: "yoti",
        decision: "verified_adult",
        auditState: "current",
        verifiedAt: "2026-08-05T19:00:00.000Z",
        expiresAt: "2026-09-05T19:00:00.000Z",
      },
    }),
    migrateAccounts: async () => ({
      ok: true,
      productAccountId: "account-1",
      migrated: true,
    }),
    ...overrides,
  };
}

describe("server Social access resolution", () => {
  it("returns preview without consulting identity while beta is disabled", async () => {
    const verifyClerkSession = vi.fn(async () => {
      throw new Error("must not run");
    });

    await expect(
      resolveSocialAccess(dependencies({ betaEnabled: false, verifyClerkSession })),
    ).resolves.toEqual({ available: true, state: "preview" });
    expect(verifyClerkSession).not.toHaveBeenCalled();
  });

  it("fails closed when Clerk session checking is unavailable", async () => {
    await expect(
      resolveSocialAccess(
        dependencies({
          verifyClerkSession: async () => ({ status: "unavailable" }),
        }),
      ),
    ).resolves.toEqual({
      available: false,
      state: "preview",
      code: "SOCIAL_ACCESS_UNAVAILABLE",
      error: "Social access checks are unavailable right now.",
      retryable: true,
    });
  });

  it("returns sign-in required without reading account state for no Clerk session", async () => {
    const readAccountAccess = vi.fn(async () => {
      throw new Error("must not run");
    });

    await expect(
      resolveSocialAccess(
        dependencies({
          verifyClerkSession: async () => ({ status: "absent" }),
          readAccountAccess,
        }),
      ),
    ).resolves.toEqual({ available: true, state: "sign_in_required" });
    expect(readAccountAccess).not.toHaveBeenCalled();
  });

  it("returns verified from server-held account and Yoti evidence", async () => {
    await expect(
      resolveSocialAccess(dependencies()),
    ).resolves.toEqual({ available: true, state: "verified" });
  });

  it("fails closed when private account storage is unavailable", async () => {
    await expect(
      resolveSocialAccess(
        dependencies({
          readAccountAccess: async () => {
            throw new Error("offline");
          },
        }),
      ),
    ).resolves.toMatchObject({
      available: false,
      state: "preview",
      code: "SOCIAL_ACCESS_UNAVAILABLE",
    });
  });
});

describe("Clerk and Supabase account migration", () => {
  it("denies migration before identity or storage work while beta is disabled", async () => {
    const verifyClerkSession = vi.fn(async () => ({
      status: "verified" as const,
      userId: "clerk-1",
    }));
    const migrateAccounts = vi.fn(async () => ({
      ok: true as const,
      productAccountId: "account-1",
      migrated: true,
    }));

    await expect(
      migrateSocialProductAccount(
        verifiedSupabase,
        dependencies({
          betaEnabled: false,
          verifyClerkSession,
          migrateAccounts,
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      status: 403,
      code: "SOCIAL_BETA_DISABLED",
      error: "Social account migration is not available in preview.",
    });
    expect(verifyClerkSession).not.toHaveBeenCalled();
    expect(migrateAccounts).not.toHaveBeenCalled();
  });

  it("requires both independently verified sessions", async () => {
    await expect(
      migrateSocialProductAccount(
        { status: "invalid" },
        dependencies(),
      ),
    ).resolves.toEqual({
      ok: false,
      status: 401,
      code: "BOTH_SESSIONS_REQUIRED",
      error: "Sign in with both accounts to move your existing PUBMAX account.",
    });
  });

  it("fails closed when either identity provider is unavailable", async () => {
    await expect(
      migrateSocialProductAccount(
        { status: "unavailable" },
        dependencies(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: "ACCOUNT_MIGRATION_UNAVAILABLE",
      retryable: true,
    });
  });

  it("passes only server-derived Clerk and Supabase IDs to the transaction", async () => {
    const migrateAccounts = vi.fn(async () => ({
      ok: true as const,
      productAccountId: "account-1",
      migrated: false,
    }));

    await expect(
      migrateSocialProductAccount(
        verifiedSupabase,
        dependencies({ migrateAccounts }),
      ),
    ).resolves.toMatchObject({ ok: true, migrated: false });
    expect(migrateAccounts).toHaveBeenCalledWith({
      clerkUserId: "clerk-1",
      supabaseUserId: "44444444-4444-4444-8444-444444444444",
    });
  });
});
