import { describe, expect, it } from "vitest";

import {
  publicSocialConnection,
  validateManualSocialProfile,
  type StoredSocialConnection,
} from "@/lib/socialConnections";

describe("external social account policy", () => {
  it("allows only an Instagram personal profile as a manual connection", () => {
    expect(
      validateManualSocialProfile({
        provider: "instagram",
        accountKind: "personal",
        profileUrl: "https://www.instagram.com/night.owl/",
      }),
    ).toEqual({
      ok: true,
      username: "night.owl",
      profileUrl: "https://www.instagram.com/night.owl/",
    });

    expect(
      validateManualSocialProfile({
        provider: "x",
        accountKind: "personal",
        profileUrl: "https://x.com/nightowl",
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateManualSocialProfile({
        provider: "instagram",
        accountKind: "personal",
        profileUrl: "https://evil.example/night.owl",
      }),
    ).toMatchObject({ ok: false });
  });

  it("never exposes OAuth credentials in the public connection projection", () => {
    const stored: StoredSocialConnection = {
      id: "connection-1",
      ownerId: "user-1",
      provider: "tiktok",
      mode: "oauth",
      accountKind: "professional",
      providerAccountId: "open-id-1",
      username: "nightowl",
      profileUrl: "https://www.tiktok.com/@nightowl",
      scopes: ["user.info.basic"],
      accessTokenCiphertext: "secret-access-token",
      refreshTokenCiphertext: "secret-refresh-token",
      // Keep this projection test independent of the wall clock. Expiry
      // behavior has its own tests; this fixture exercises secret redaction.
      tokenExpiresAt: "2099-07-16T12:00:00.000Z",
      connectedAt: "2026-07-15T12:00:00.000Z",
      updatedAt: "2026-07-15T12:00:00.000Z",
    };

    const projected = publicSocialConnection(stored);
    expect(projected).toEqual({
      provider: "tiktok",
      mode: "oauth",
      accountKind: "professional",
      status: "connected",
      username: "nightowl",
      profileUrl: "https://www.tiktok.com/@nightowl",
      scopes: ["user.info.basic"],
      connectedAt: "2026-07-15T12:00:00.000Z",
      updatedAt: "2026-07-15T12:00:00.000Z",
    });
    expect(JSON.stringify(projected)).not.toContain("secret");
    expect(JSON.stringify(projected)).not.toContain("providerAccountId");
  });
});
