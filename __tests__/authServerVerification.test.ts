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

describe("verifyCallerAuth — the deleted-account lane", () => {
  // `DELETE /api/account` must still answer after the account it names is gone,
  // so its bearer may outlive the auth row. It must NOT outlive a sign-out, a
  // password change or a ban (audit finding
  // lib/authServer:localOnly-jwt-lane-skips-revocation-ban-and-audience): the
  // lane asks GoTrue first and binds the signed claims to this app's audience
  // and role. Only `user_not_found` permits naming a deleted account.
  function adminWith(
    getUser: ReturnType<typeof vi.fn>,
    getClaims: ReturnType<typeof vi.fn> = vi.fn(),
  ) {
    return { auth: { getUser, getClaims } };
  }

  const liveClaims = {
    sub: "user-1",
    email: "k@example.com",
    aud: "authenticated",
    role: "authenticated",
  };

  function claimsLane(claims: Record<string, unknown>) {
    return vi.fn().mockResolvedValue({ data: { claims }, error: null });
  }

  function gotrueError(error: Record<string, unknown>) {
    return vi.fn().mockResolvedValue({ data: { user: null }, error });
  }

  it("asks GoTrue first and answers a live account from it", async () => {
    const getClaims = claimsLane(liveClaims);
    const admin = adminWith(
      vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "k@example.com", created_at: "2026-01-01T00:00:00Z" } },
        error: null,
      }),
      getClaims,
    );
    authState.admin = admin as never;

    await expect(
      verifyCallerAuth(request("live-token"), { allowDeletedAccount: true }),
    ).resolves.toEqual({
      status: "verified",
      identity: { id: "user-1", email: "k@example.com", createdAt: "2026-01-01T00:00:00Z" },
    });
    expect(admin.auth.getUser).toHaveBeenCalledWith("live-token");
    expect(getClaims).toHaveBeenCalledWith("live-token");
  });

  it.each([
    ["a revoked session", { status: 403, code: "session_not_found" }],
    ["a missing session", { name: "AuthSessionMissingError", status: 400 }],
    ["a foreign audience", { status: 401, code: "unexpected_audience" }],
    ["a forged or expired token", { status: 401, code: "bad_jwt" }],
  ])("refuses %s even though its signature still verifies", async (_label, error) => {
    const getClaims = claimsLane(liveClaims);
    authState.admin = adminWith(gotrueError(error), getClaims) as never;

    await expect(
      verifyCallerAuth(request("captured-token"), { allowDeletedAccount: true }),
    ).resolves.toEqual({ status: "invalid" });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("refuses a banned account, whether GoTrue says so in the error or the user", async () => {
    const getClaims = claimsLane(liveClaims);
    authState.admin = adminWith(
      gotrueError({ status: 403, code: "user_banned" }),
      getClaims,
    ) as never;
    await expect(
      verifyCallerAuth(request("banned-token"), { allowDeletedAccount: true }),
    ).resolves.toEqual({ status: "banned" });

    authState.admin = adminWith(
      vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: null, banned_until: "2999-01-01T00:00:00.000Z" } },
        error: null,
      }),
      getClaims,
    ) as never;
    await expect(
      verifyCallerAuth(request("banned-token"), { allowDeletedAccount: true }),
    ).resolves.toEqual({ status: "banned" });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("names a deleted account from its own verified claims", async () => {
    const getClaims = claimsLane({ ...liveClaims, sub: "deleted-account" });
    authState.admin = adminWith(
      gotrueError({ status: 403, code: "user_not_found" }),
      getClaims,
    ) as never;

    await expect(
      verifyCallerAuth(request("token-of-a-deleted-account"), { allowDeletedAccount: true }),
    ).resolves.toEqual({
      status: "verified",
      identity: { id: "deleted-account", email: "k@example.com", createdAt: null },
    });
    expect(getClaims).toHaveBeenCalledWith("token-of-a-deleted-account");
  });

  it("accepts the audience as a list that names this app", async () => {
    authState.admin = adminWith(
      gotrueError({ status: 403, code: "user_not_found" }),
      claimsLane({ ...liveClaims, aud: ["authenticated"] }),
    ) as never;

    await expect(
      verifyCallerAuth(request("token"), { allowDeletedAccount: true }),
    ).resolves.toMatchObject({ status: "verified" });
  });

  it.each([
    ["a foreign audience", { aud: "another-app" }],
    ["no audience", { aud: undefined }],
    ["the anon role", { role: "anon" }],
    ["the service role", { role: "service_role" }],
    ["no subject", { sub: undefined }],
  ])("refuses a deleted account's token with %s", async (_label, overrides) => {
    authState.admin = adminWith(
      gotrueError({ status: 403, code: "user_not_found" }),
      claimsLane({ ...liveClaims, ...overrides }),
    ) as never;

    await expect(
      verifyCallerAuth(request("token"), { allowDeletedAccount: true }),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("reads an expired or forged deleted-account token as invalid", async () => {
    authState.admin = adminWith(
      gotrueError({ status: 403, code: "user_not_found" }),
      vi.fn().mockResolvedValue({ data: null, error: { name: "AuthInvalidJwtError", status: 401 } }),
    ) as never;

    await expect(
      verifyCallerAuth(request("bad"), { allowDeletedAccount: true }),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("answers unavailable when GoTrue cannot answer, and never reads the claims", async () => {
    const getClaims = claimsLane(liveClaims);
    authState.admin = adminWith(
      gotrueError({ status: 503, code: "unexpected_failure" }),
      getClaims,
    ) as never;

    await expect(
      verifyCallerAuth(request("token"), { allowDeletedAccount: true }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(getClaims).not.toHaveBeenCalled();
  });
});

// THE REGRESSION (review finding F-3). #1501 made the local lane the DEFAULT to
// spare a messaging poll a round trip, and `getClaims` checks a signature and an
// expiry and nothing else — so a token whose account had just been deleted still
// verified, and the contribution gate on every price write, the Social 18+ gate,
// the two plan-seat claims and the session refresh all kept saying yes for the
// rest of that token's hour. The default asks GoTrue, which is the only party
// that knows the account is gone.
describe("verifyCallerAuth — revocation by default", () => {
  it("asks the auth server when no option is passed, even where a local lane exists", async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: { claims: { sub: "deleted-account", email: "gone@example.com" } },
      error: null,
    });
    const admin = { auth: { getUser: vi.fn(), getClaims } };
    admin.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401, code: "user_not_found" },
    });
    authState.admin = admin as never;

    await expect(verifyCallerAuth(request("token-of-a-deleted-account"))).resolves.toEqual({
      status: "invalid",
    });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("carries account metadata on the default lane, so callerAuthIdentity needs no option", async () => {
    authState.admin?.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "k@example.com", created_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });

    await expect(verifyCallerAuth(request("token"))).resolves.toEqual({
      status: "verified",
      identity: { id: "user-1", email: "k@example.com", createdAt: "2026-01-01T00:00:00Z" },
    });
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

  it("answers banned when GoTrue still has a future banned_until", async () => {
    authState.admin?.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "a@example.com",
          banned_until: "2999-01-01T00:00:00.000Z",
        },
      },
      error: null,
    });

    await expect(verifyCallerAuth(request("token"))).resolves.toEqual({ status: "banned" });
  });

  it("does not treat an expired ban as a ban", async () => {
    authState.admin?.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "a@example.com",
          banned_until: "2000-01-01T00:00:00.000Z",
        },
      },
      error: null,
    });

    await expect(verifyCallerAuth(request("token"))).resolves.toEqual({
      status: "verified",
      identity: { id: "user-1", email: "a@example.com", createdAt: null },
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
