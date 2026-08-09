import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => { throw new Error("not configured"); },
}));

import {
  createSocialOAuthStart,
  readSocialOAuthState,
  socialProviderAvailability,
} from "@/lib/socialOAuth";

describe("social OAuth state", () => {
  afterEach(() => {
    delete process.env.X_CLIENT_ID;
    delete process.env.X_CLIENT_SECRET;
    delete process.env.INSTAGRAM_CLIENT_ID;
    delete process.env.INSTAGRAM_CLIENT_SECRET;
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
    delete process.env.SOCIAL_CONNECTION_ENCRYPTION_KEY;
  });

  it("keeps ownership and the PKCE verifier server-side and consumes state once", async () => {
    process.env.X_CLIENT_ID = "client-id";
    process.env.X_CLIENT_SECRET = "client-secret";
    process.env.SOCIAL_CONNECTION_ENCRYPTION_KEY = "e".repeat(32);
    const { authorizeUrl } = await createSocialOAuthStart({ ownerId: "user-1", provider: "x", origin: "https://pubmaxxing.com" });
    const state = new URL(authorizeUrl).searchParams.get("state")!;

    expect(state).not.toContain("user-1");
    const stored = await readSocialOAuthState(state, "x");
    expect(stored).toMatchObject({ ownerId: "user-1", provider: "x" });
    await expect(readSocialOAuthState(state, "x")).rejects.toThrow("Expired or mismatched OAuth state");
  });

  it("advertises OAuth only when the server can complete and encrypt the flow", () => {
    process.env.X_CLIENT_ID = "x-id";
    process.env.X_CLIENT_SECRET = "x-secret";
    process.env.INSTAGRAM_CLIENT_ID = "instagram-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "instagram-secret";

    // Manual is never gated on an app registration: typing your own handle
    // needs nobody's client id. Only the OAuth arm waits on configuration.
    expect(socialProviderAvailability()).toMatchObject({
      x: { oauth: false, manual: true },
      instagram: { oauth: false, manual: true },
      tiktok: { oauth: false, manual: true },
      letterboxd: { oauth: false, manual: true },
      website: { oauth: false, manual: true },
    });

    process.env.SOCIAL_CONNECTION_ENCRYPTION_KEY = "e".repeat(32);
    expect(socialProviderAvailability()).toMatchObject({
      x: { oauth: true },
      instagram: { oauth: true, manual: true },
      tiktok: { oauth: false },
      // A provider with no OAuth app can never advertise OAuth, however the
      // environment is configured.
      letterboxd: { oauth: false, manual: true },
    });
  });
});
