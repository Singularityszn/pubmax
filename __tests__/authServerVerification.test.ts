import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every file under a directory, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

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

describe("verifyCallerAuth — the opt-in local claims lane", () => {
  // `getClaims` verifies the token against the project's JWKS and asks the auth
  // server nothing. That is faster and WEAKER: it says the signature and the
  // expiry are good and says nothing about whether the account still exists.
  // So it is opt-in, and `DELETE /api/account` is the whole list of callers.
  function adminWithClaims(getClaims: ReturnType<typeof vi.fn>) {
    return { auth: { getUser: vi.fn(), getClaims } };
  }

  it("verifies the bearer locally and never calls getUser when asked to", async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: { claims: { sub: "user-1", email: "k@example.com" } },
      error: null,
    });
    const admin = adminWithClaims(getClaims);
    authState.admin = admin as never;

    await expect(
      verifyCallerAuth(request("es256-token"), { localOnly: true }),
    ).resolves.toEqual({
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
    await expect(
      verifyCallerAuth(request("bad"), { localOnly: true }),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("falls through to the auth server when the client cannot verify locally", async () => {
    // An older supabase-js has no `getClaims`. The opt-in caller is not left
    // unverified: it takes the account check it was trying to skip.
    authState.admin?.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: null, created_at: null } },
      error: null,
    });

    await expect(
      verifyCallerAuth(request("token"), { localOnly: true }),
    ).resolves.toEqual({
      status: "verified",
      identity: { id: "user-1", email: null, createdAt: null },
    });
    expect(authState.admin?.auth.getUser).toHaveBeenCalledWith("token");
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

  it("is asked for locally by ONE door in the tree, and it is the account delete", () => {
    // A source fence, because no runtime test can sweep the callers. The option
    // exists for an idempotent DELETE that must still answer after the account
    // it names is gone; anywhere else it is a gate that outlives its account.
    const OWNER = "lib/authServer.ts";
    const roots = ["app", "lib", "components"];
    const askers: string[] = [];
    for (const root of roots) {
      for (const file of walk(join(process.cwd(), root))) {
        if (!/\.tsx?$/.test(file)) continue;
        const path = relative(process.cwd(), file);
        if (path === OWNER) continue;
        if (readFileSync(file, "utf8").includes("localOnly: true")) askers.push(path);
      }
    }
    expect(askers.sort()).toEqual(["app/api/account/route.ts"]);
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
