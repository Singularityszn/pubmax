import { describe, expect, it } from "vitest";

import { decideSocialAccess } from "@/lib/socialAccess";

const NOW = "2026-08-05T20:00:00.000Z";

describe("Social access policy", () => {
  it("keeps disabled Social at safe preview", () => {
    expect(
      decideSocialAccess({
        betaEnabled: false,
        clerkUserId: "clerk-1",
        account: null,
        verification: null,
        now: NOW,
      }),
    ).toBe("preview");
  });

  it("requires a Clerk product session once Social is enabled", () => {
    expect(
      decideSocialAccess({
        betaEnabled: true,
        clerkUserId: null,
        account: null,
        verification: null,
        now: NOW,
      }),
    ).toBe("sign_in_required");
  });

  it("requires current Yoti adult evidence bound to the product account", () => {
    expect(
      decideSocialAccess({
        betaEnabled: true,
        clerkUserId: "clerk-1",
        account: {
          id: "account-1",
          clerkUserId: "clerk-1",
          ownershipState: "active",
        },
        verification: null,
        now: NOW,
      }),
    ).toBe("age_verification_required");
  });

  it("grants verified access only for unexpired authoritative Yoti evidence", () => {
    expect(
      decideSocialAccess({
        betaEnabled: true,
        clerkUserId: "clerk-1",
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
        now: NOW,
      }),
    ).toBe("verified");
  });

  it.each([
    ["expired", { expiresAt: NOW }],
    ["future-dated", { verifiedAt: "2026-08-05T21:00:00.000Z" }],
    ["revoked", { auditState: "revoked" as const }],
    ["negative", { decision: "not_verified" as const }],
    ["wrong account", { productAccountId: "account-2" }],
  ])("rejects %s assurance", (_label, override) => {
    expect(
      decideSocialAccess({
        betaEnabled: true,
        clerkUserId: "clerk-1",
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
          ...override,
        },
        now: NOW,
      }),
    ).toBe("age_verification_required");
  });

  it("keeps a suspended account closed even with current evidence", () => {
    expect(
      decideSocialAccess({
        betaEnabled: true,
        clerkUserId: "clerk-1",
        account: {
          id: "account-1",
          clerkUserId: "clerk-1",
          ownershipState: "suspended",
        },
        verification: {
          productAccountId: "account-1",
          provider: "yoti",
          decision: "verified_adult",
          auditState: "current",
          verifiedAt: "2026-08-05T19:00:00.000Z",
          expiresAt: "2026-09-05T19:00:00.000Z",
        },
        now: NOW,
      }),
    ).toBe("suspended");
  });
});
