import { describe, expect, it, vi } from "vitest";

import {
  migrateSocialProductAccount,
  requireVerifiedSocialActor,
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
    friendsLaunchEnabled: false,
    betaEnabled: true,
    now: () => new Date("2026-08-05T20:00:00.000Z"),
    verifyClerkSession: async () => ({ status: "verified", userId: "clerk-1" }),
    verifySupabaseSession: async () => ({ status: "absent" }),
    readAccountAccess: async () => ({
      account: {
        id: "account-1",
        clerkUserId: "clerk-1",
        ownershipState: "active",
      },
      profile: {
        id: "profile-1",
        handle: "alice",
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
    readFriendsLaunchAccess: async () => ({
      account: {
        id: "account-2",
        clerkUserId: "supabase:44444444-4444-4444-8444-444444444444",
        ownershipState: "active",
      },
      profile: {
        id: "profile-2",
        handle: "bob",
      },
      dateOfBirth: "1990-01-01",
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
  it("returns preview without consulting identity while friends launch and beta are disabled", async () => {
    const verifyClerkSession = vi.fn(async () => {
      throw new Error("must not run");
    });
    const verifySupabaseSession = vi.fn(async () => {
      throw new Error("must not run");
    });

    await expect(
      resolveSocialAccess(
        undefined,
        dependencies({
          friendsLaunchEnabled: false,
          betaEnabled: false,
          verifyClerkSession,
          verifySupabaseSession,
        }),
      ),
    ).resolves.toEqual({ available: true, state: "preview" });
    expect(verifyClerkSession).not.toHaveBeenCalled();
    expect(verifySupabaseSession).not.toHaveBeenCalled();
  });

  it("returns verified from friends-launch Supabase identity and onboarding DOB", async () => {
    await expect(
      resolveSocialAccess(
        undefined,
        dependencies({
          friendsLaunchEnabled: true,
          betaEnabled: false,
          verifySupabaseSession: async () => ({
            status: "verified",
            userId: "44444444-4444-4444-8444-444444444444",
          }),
        }),
      ),
    ).resolves.toEqual({
      available: true,
      state: "verified",
      actor: { accountId: "account-2", profileId: "profile-2", handle: "bob" },
    });
  });

  it("fails closed when Clerk session checking is unavailable", async () => {
    await expect(
      resolveSocialAccess(
        undefined,
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
        undefined,
        dependencies({
          verifyClerkSession: async () => ({ status: "absent" }),
          readAccountAccess,
        }),
      ),
    ).resolves.toEqual({ available: true, state: "sign_in_required" });
    expect(readAccountAccess).not.toHaveBeenCalled();
  });

  it("returns sign-in required when the durable resume cookie has invalid escapes", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
    vi.stubEnv("SOCIAL_INVITE_BETA_ENABLED", "0");
    try {
      const request = new Request("https://pubmaxxing.com/social", {
        headers: { cookie: "pubmax_auth_resume=%zz" },
      });

      await expect(resolveSocialAccess(request)).resolves.toEqual({
        available: true,
        state: "sign_in_required",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns verified from server-held account and Yoti evidence", async () => {
    await expect(
      resolveSocialAccess(undefined, dependencies()),
    ).resolves.toEqual({
      available: true,
      state: "verified",
      actor: { accountId: "account-1", profileId: "profile-1", handle: "alice" },
    });
  });

  it("returns only a server-held internal actor to protected Social routes", async () => {
    await expect(requireVerifiedSocialActor(undefined, dependencies())).resolves.toEqual({
      ok: true,
      actor: { accountId: "account-1", profileId: "profile-1", handle: "alice" },
    });
  });

  // The refusal a caller reads names the same surface the nav, the palette and
  // /social do, so a gated deployment never sends somebody to a destination it
  // calls something else.
  it("names the gated surface in every refusal while the launch is off", async () => {
    await expect(
      requireVerifiedSocialActor(
        undefined,
        dependencies({ betaEnabled: false, friendsLaunchEnabled: false }),
      ),
    ).resolves.toMatchObject({ error: "Social preview is not open yet." });
    await expect(
      requireVerifiedSocialActor(
        undefined,
        dependencies({
          friendsLaunchEnabled: false,
          verifyClerkSession: async () => ({ status: "absent" }),
        }),
      ),
    ).resolves.toMatchObject({ error: "Sign in to use Social preview." });
  });

  it("names Social itself once the launch is on", async () => {
    await expect(
      requireVerifiedSocialActor(
        undefined,
        dependencies({
          friendsLaunchEnabled: true,
          verifyClerkSession: async () => ({ status: "absent" }),
          verifySupabaseSession: async () => ({ status: "absent" }),
        }),
      ),
    ).resolves.toMatchObject({ error: "Sign in to use Social." });
  });

  it("maps every non-verified state to a protected-route refusal", async () => {
    await expect(requireVerifiedSocialActor(undefined, dependencies({ betaEnabled: false, friendsLaunchEnabled: false })))
      .resolves.toMatchObject({ ok: false, status: 403, code: "SOCIAL_BETA_DISABLED" });
    await expect(requireVerifiedSocialActor(undefined, dependencies({
      verifyClerkSession: async () => ({ status: "absent" }),
    }))).resolves.toMatchObject({ ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED" });
  });

  it("fails closed when private account storage is unavailable", async () => {
    await expect(
      resolveSocialAccess(
        undefined,
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

describe("friends-launch auto-provision store seam", () => {
  it("maps profile_not_claimed to a null access record without throwing", async () => {
    const readFriendsLaunchAccess = vi.fn(async () => ({
      account: null,
      profile: null,
      dateOfBirth: null,
    }));

    await expect(
      resolveSocialAccess(
        undefined,
        dependencies({
          friendsLaunchEnabled: true,
          betaEnabled: false,
          verifySupabaseSession: async () => ({
            status: "verified",
            userId: "44444444-4444-4444-8444-444444444444",
          }),
          readFriendsLaunchAccess,
        }),
      ),
    ).resolves.toEqual({
      available: true,
      state: "age_verification_required",
      // No claimed handle, so the one tap is not what stands in the way. A
      // button that recorded a true assertion and still refused would read as
      // broken; the claim surface is what this account is owed.
      adultPrompt: false,
    });
  });

  it("offers the one tap to a claimed handle with no age answer at all", async () => {
    const readFriendsLaunchAccess = vi.fn(async () => ({
      account: {
        id: "account-1",
        clerkUserId: "clerk-1",
        ownershipState: "active" as const,
      },
      profile: { id: "profile-1", handle: "night_owl" },
      dateOfBirth: null,
      adultSelfAssertedAt: null,
    }));

    await expect(
      resolveSocialAccess(
        undefined,
        dependencies({
          friendsLaunchEnabled: true,
          betaEnabled: false,
          verifySupabaseSession: async () => ({
            status: "verified",
            userId: "44444444-4444-4444-8444-444444444444",
          }),
          readFriendsLaunchAccess,
        }),
      ),
    ).resolves.toEqual({
      available: true,
      state: "age_verification_required",
      adultPrompt: true,
    });
  });

  it("verifies a claimed handle on a recorded assertion alone", async () => {
    const readFriendsLaunchAccess = vi.fn(async () => ({
      account: {
        id: "account-1",
        clerkUserId: "clerk-1",
        ownershipState: "active" as const,
      },
      profile: { id: "profile-1", handle: "night_owl" },
      dateOfBirth: null,
      adultSelfAssertedAt: "2026-08-10T18:00:00.000Z",
    }));

    await expect(
      resolveSocialAccess(
        undefined,
        dependencies({
          friendsLaunchEnabled: true,
          betaEnabled: false,
          verifySupabaseSession: async () => ({
            status: "verified",
            userId: "44444444-4444-4444-8444-444444444444",
          }),
          readFriendsLaunchAccess,
        }),
      ),
    ).resolves.toEqual({
      available: true,
      state: "verified",
      actor: {
        accountId: "account-1",
        profileId: "profile-1",
        handle: "night_owl",
      },
    });
  });
});
