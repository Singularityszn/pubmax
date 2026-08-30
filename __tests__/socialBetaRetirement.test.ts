import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  resolveSocialAccess,
  type SocialAccessServerDependencies,
} from "@/lib/socialAccessServer";
import { isSocialFriendsLaunchEnabled } from "@/lib/socialLaunch";

const ROOT = process.cwd();
const USER_ID = "44444444-4444-4444-8444-444444444444";

const ACTIVE_SURFACES = [
  "app/api/social",
  "app/social",
  "components/social",
  "lib/socialAccess.ts",
  "lib/socialAccessServer.ts",
  "lib/socialLaunch.ts",
  "app/api/identity/adult-assertion/route.ts",
  "docs/SOFT_LAUNCH_RUNBOOK.md",
  "docs/prd/SOCIAL_LAUNCH_PRD.md",
  ".env.example",
  "package.json",
  "proxy.ts",
];

const ACTIVE_SOCIAL_CODE = [
  "app/api/social",
  "app/social",
  "components/social",
  "lib/socialAccess.ts",
  "lib/socialAccessServer.ts",
  "lib/socialLaunch.ts",
  "app/api/identity/adult-assertion/route.ts",
];

const RETIRED_MARKERS = [
  "SOCIAL_INVITE_BETA_ENABLED",
  "SOCIAL_BETA_DISABLED",
  "isSocialInviteBetaEnabled",
  "migrateSocialProductAccount",
];

function filesAt(relativePath: string): string[] {
  const absolutePath = join(ROOT, relativePath);
  if (statSync(absolutePath).isFile()) return [relativePath];
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) =>
    filesAt(join(relativePath, entry.name)),
  );
}

function sourceFiles(paths: string[]): Map<string, string> {
  return new Map(
    Array.from(new Set(paths.flatMap(filesAt))).map((relativePath) => [
      relativePath,
      readFileSync(join(ROOT, relativePath), "utf8"),
    ]),
  );
}

function dependencies(
  overrides: Partial<SocialAccessServerDependencies> = {},
): SocialAccessServerDependencies {
  return {
    friendsLaunchEnabled: true,
    now: () => new Date("2026-08-30T20:00:00.000Z"),
    verifySupabaseSession: async () => ({
      status: "verified" as const,
      userId: USER_ID,
    }),
    readFriendsLaunchAccess: async () => ({
      account: {
        id: "account-1",
        clerkUserId: `supabase:${USER_ID}`,
        ownershipState: "active" as const,
      },
      profile: { id: "profile-1", handle: "alice" },
      dateOfBirth: "1990-01-01",
    }),
    ...overrides,
  };
}

describe("retired Social beta access boundary", () => {
  it("keeps retired flags and legacy provider branches out of active surfaces", () => {
    const activeSources = sourceFiles(ACTIVE_SURFACES);
    for (const [relativePath, source] of activeSources) {
      for (const marker of RETIRED_MARKERS) {
        expect(source, `${relativePath} still contains ${marker}`).not.toContain(
          marker,
        );
      }
    }

    const socialCode = sourceFiles(ACTIVE_SOCIAL_CODE);
    const legacyBranch =
      /\b(?:verifyClerkSession|clerkSession|clerkIdentity|yoti|migrateSocialProductAccount)\b/i;
    for (const [relativePath, source] of socialCode) {
      expect(source, `${relativePath} still contains legacy Social auth`).not.toMatch(
        legacyBranch,
      );
    }
  });

  it("keeps Supabase verified access and explicit emergency rollback", async () => {
    expect(isSocialFriendsLaunchEnabled(undefined)).toBe(true);
    expect(isSocialFriendsLaunchEnabled("1")).toBe(true);
    expect(isSocialFriendsLaunchEnabled("0")).toBe(false);

    await expect(resolveSocialAccess(undefined, dependencies())).resolves.toEqual({
      available: true,
      state: "verified",
      actor: {
        accountId: "account-1",
        profileId: "profile-1",
        handle: "alice",
      },
    });

    const verify = vi.fn(async () => ({
      status: "verified" as const,
      userId: USER_ID,
    }));
    await expect(
      resolveSocialAccess(
        undefined,
        dependencies({ friendsLaunchEnabled: false, verifySupabaseSession: verify }),
      ),
    ).resolves.toEqual({ available: true, state: "preview" });
    expect(verify).not.toHaveBeenCalled();
  });
});
