import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => { throw new Error("not configured"); },
}));

import { createSocialOAuthStart, readSocialOAuthState } from "@/lib/socialOAuth";

describe("social OAuth state", () => {
  afterEach(() => { delete process.env.X_CLIENT_ID; });

  it("keeps ownership and the PKCE verifier server-side and consumes state once", async () => {
    process.env.X_CLIENT_ID = "client-id";
    const { authorizeUrl } = await createSocialOAuthStart({ ownerId: "user-1", provider: "x", origin: "https://pubmaxxing.com" });
    const state = new URL(authorizeUrl).searchParams.get("state")!;

    expect(state).not.toContain("user-1");
    const stored = await readSocialOAuthState(state, "x");
    expect(stored).toMatchObject({ ownerId: "user-1", provider: "x" });
    await expect(readSocialOAuthState(state, "x")).rejects.toThrow("Expired or mismatched OAuth state");
  });
});
