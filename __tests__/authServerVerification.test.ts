import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  admin: null as {
    auth: {
      getUser: ReturnType<typeof vi.fn>;
    };
  } | null,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => authState.admin,
}));

import { verifyCallerAuth } from "@/lib/authServer";

function request(token?: string): Request {
  return new Request("http://localhost/api/contribution", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  authState.admin = {
    auth: {
      getUser: vi.fn(),
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyCallerAuth — local claims lane", () => {
  // `auth.getUser` is a network round trip to GoTrue on EVERY request. When the
  // client can verify the token against the project's JWKS (`getClaims`), the
  // id lane takes that answer and asks the auth server nothing.
  function adminWithClaims(getClaims: ReturnType<typeof vi.fn>) {
    return { auth: { getUser: vi.fn(), getClaims } };
  }

  it("verifies the bearer locally and never calls getUser for an id", async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: { claims: { sub: "user-1", email: "k@example.com" } },
      error: null,
    });
    const admin = adminWithClaims(getClaims);
    authState.admin = admin as never;

    await expect(verifyCallerAuth(request("es256-token"))).resolves.toEqual({
      status: "verified",
      identity: { id: "user-1", email: "k@example.com", createdAt: null },
    });
    expect(getClaims).toHaveBeenCalledWith("es256-token");
    expect(admin.auth.getUser).not.toHaveBeenCalled();
  });

  it("reads an expired or forged token as invalid through the same code table", async () => {
    const admin = adminWithClaims(
      vi.fn().mockResolvedValue({ data: null, error: { name: "AuthInvalidJwtError", status: 401 } }),
    );
    authState.admin = admin as never;
    await expect(verifyCallerAuth(request("bad"))).resolves.toEqual({ status: "invalid" });
  });

  it("asks the auth server only when the caller needs account metadata", async () => {
    const getClaims = vi.fn();
    const admin = adminWithClaims(getClaims);
    admin.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "k@example.com", created_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });
    authState.admin = admin as never;

    await expect(
      verifyCallerAuth(request("token"), { accountMetadata: true }),
    ).resolves.toEqual({
      status: "verified",
      identity: { id: "user-1", email: "k@example.com", createdAt: "2026-01-01T00:00:00Z" },
    });
    expect(getClaims).not.toHaveBeenCalled();
  });
});

describe("verifyCallerAuth", () => {
  it("distinguishes an absent token", async () => {
    await expect(verifyCallerAuth(request())).resolves.toEqual({
      status: "absent",
    });
    expect(authState.admin?.auth.getUser).not.toHaveBeenCalled();
  });

  it("distinguishes a verified-invalid token", async () => {
    authState.admin?.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401, code: "bad_jwt" },
    });

    await expect(verifyCallerAuth(request("expired-token"))).resolves.toEqual({
      status: "invalid",
    });
  });

  it("treats a revoked session as verified invalid", async () => {
    authState.admin?.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError", status: 400 },
    });

    await expect(verifyCallerAuth(request("revoked-token"))).resolves.toEqual({
      status: "invalid",
    });
  });

  it("distinguishes unavailable verification", async () => {
    authState.admin = null;

    await expect(verifyCallerAuth(request("valid-token"))).resolves.toEqual({
      status: "unavailable",
    });
  });

  // No environment may stand in for the admin verifier. A keyless process has
  // nothing that can check a signature or an expiry, so the only honest answer
  // is "we could not verify" - never "verified". This test exists because a
  // fixture map keyed on the bearer string itself was proposed to make a
  // browser test pass, and a bearer string that IS the password is a backdoor
  // however narrowly its flag is gated.
  it("answers unavailable with no admin client whatever the environment says", async () => {
    authState.admin = null;
    vi.stubEnv("PUBMAX_E2E_KEYLESS", "1");
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv(
      "PUBMAX_E2E_AUTH_USERS",
      JSON.stringify({
        "pubmaxx-e2e-access-token-A": {
          id: "00000000-0000-4000-8000-0000000000a1",
        },
      }),
    );

    await expect(
      verifyCallerAuth(request("pubmaxx-e2e-access-token-A")),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("does not treat a transient verification failure as invalid", async () => {
    authState.admin?.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 503, code: "unexpected_failure" },
    });

    await expect(verifyCallerAuth(request("valid-token"))).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("does not treat a network failure as invalid", async () => {
    authState.admin?.auth.getUser.mockRejectedValue(
      new Error("auth network unavailable"),
    );

    await expect(verifyCallerAuth(request("valid-token"))).resolves.toEqual({
      status: "unavailable",
    });
  });
});
