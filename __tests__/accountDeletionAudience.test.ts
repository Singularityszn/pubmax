import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: null as ReturnType<typeof createClient> | null,
  deleteOwnAccount: vi.fn(),
}));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  getSupabaseAdmin: () => state.admin,
  isSupabaseConfigured: () => true,
}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/messageAuth", () => ({ resolveMessageHandle: async () => null }));
vi.mock("@/lib/accountDeletion.server", () => ({ deleteOwnAccount: state.deleteOwnAccount }));

import { DELETE } from "@/app/api/account/route";

beforeEach(() => {
  state.deleteOwnAccount.mockReset().mockResolvedValue("deleted");
});

describe("DELETE /api/account signed token binding", () => {
  // Audit contract: even when GoTrue returns a live user, a signed token for
  // another audience or role must receive 401 without deleting the account.
  // The real Supabase client verifies ES256 signatures against the fixture JWKS.
  it.each([
    ["foreign-app", "authenticated", 401],
    ["authenticated", "anon", 401],
    ["authenticated", "service_role", 401],
    ["authenticated", "authenticated", 200],
    [["authenticated"], "authenticated", 200],
  ])("checks audience %j and role %s", async (aud, role, status) => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const kid = randomUUID();
    const userId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: userId, aud, role, iss: "https://auth.example.test/auth/v1",
      iat: now, exp: now + 3600,
    };
    const encoded = [
      { alg: "ES256", typ: "JWT", kid }, payload,
    ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".");
    const signature = sign("sha256", Buffer.from(encoded), {
      key: privateKey, dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    const token = `${encoded}.${signature}`;
    state.admin = createClient("https://auth.example.test", "test-service-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input) => {
          const url = String(input);
          if (url.endsWith("/auth/v1/user")) {
            // GoTrue returns the account audience, not the token audience.
            return Response.json({ id: userId, aud: "authenticated", email: "owner@example.test" });
          }
          if (url.endsWith("/auth/v1/.well-known/jwks.json")) {
            return Response.json({
              keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" }],
            });
          }
          throw new Error(`Unexpected Auth request: ${url}`);
        },
      },
    });

    const response = await DELETE(new Request("http://localhost/api/account", {
      method: "DELETE", headers: { authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(status);
    if (status === 401) {
      expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
      expect(state.deleteOwnAccount).not.toHaveBeenCalled();
    } else {
      expect(await response.json()).toEqual({ deleted: true });
      expect(state.deleteOwnAccount).toHaveBeenCalledExactlyOnceWith(userId);
    }
  });
});
