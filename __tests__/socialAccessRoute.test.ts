import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const state = vi.hoisted(() => ({
  access: { available: true, state: "sign_in_required" } as unknown,
  migration: {
    ok: true,
    productAccountId: "account-1",
    migrated: true,
  } as unknown,
  auth: {
    status: "verified",
    identity: {
      id: "legacy-account-1",
      email: null,
      createdAt: null,
    },
  } as unknown,
  migrationAuthority: null as unknown,
  authVerifierCalls: 0,
  accessArgs: [] as unknown[],
}));

vi.mock("@/lib/authServer", () => ({
  verifyCallerAuth: async () => {
    state.authVerifierCalls += 1;
    return state.auth;
  },
}));

vi.mock("@/lib/socialAccessServer", () => ({
  resolveSocialAccess: async (...args: unknown[]) => {
    state.accessArgs = args;
    return state.access;
  },
  migrateSocialProductAccount: async (authority: unknown) => {
    state.migrationAuthority = authority;
    return state.migration;
  },
}));

import { GET, POST } from "@/app/api/social/access/route";

function request(method = "GET"): Request {
  return new Request("http://localhost/api/social/access", { method });
}

beforeEach(() => {
  vi.stubEnv("SOCIAL_INVITE_BETA_ENABLED", "1");
  state.access = { available: true, state: "sign_in_required" };
  state.migration = {
    ok: true,
    productAccountId: "account-1",
    migrated: true,
  };
  state.auth = {
    status: "verified",
    identity: {
      id: "legacy-account-1",
      email: null,
      createdAt: null,
    },
  };
  state.migrationAuthority = null;
  state.authVerifierCalls = 0;
  state.accessArgs = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/social/access", () => {
  it("returns only public access state with private no-store caching", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ state: "sign_in_required" });
    expect(state.accessArgs[2]).toEqual({ allowResumeCookie: false });
  });

  it("does not allow a cross-site top-level GET to redeem a resume cookie", async () => {
    const response = await GET(new Request("http://localhost/api/social/access", {
      headers: {
        Origin: "https://attacker.example",
        Cookie: "pubmax_session_resume=opaque-refresh-cookie",
      },
    }));

    expect(response.status).toBe(200);
    expect(state.accessArgs[2]).toEqual({ allowResumeCookie: false });
  });

  it("fails closed with preview plus honest unavailable semantics", async () => {
    state.access = {
      available: false,
      state: "preview",
      code: "SOCIAL_ACCESS_UNAVAILABLE",
      error: "Social access checks are unavailable right now.",
      retryable: true,
    };

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(state.access);
  });

  it("migrates from server-derived sessions without accepting a handle body", async () => {
    const response = await POST(request("POST"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ migrated: true });
    expect(state.migrationAuthority).toEqual(state.auth);
  });

  it("preserves the disabled-beta write refusal", async () => {
    vi.stubEnv("SOCIAL_INVITE_BETA_ENABLED", "0");
    state.migration = {
      ok: false,
      status: 403,
      code: "SOCIAL_BETA_DISABLED",
      error: "Social account migration is not available in preview.",
    };

    const response = await POST(request("POST"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "SOCIAL_BETA_DISABLED",
      retryable: false,
      error: "Social account migration is not available in preview.",
    });
    expect(state.authVerifierCalls).toBe(0);
    expect(state.migrationAuthority).toBeNull();
  });

  it("preserves migration conflict and dependency status", async () => {
    state.migration = {
      ok: false,
      status: 409,
      code: "ACCOUNT_OWNERSHIP_CONFLICT",
      error: "Those sign-in accounts already belong to different PUBMAX accounts.",
    };

    const response = await POST(request("POST"));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "ACCOUNT_OWNERSHIP_CONFLICT",
      error: "Those sign-in accounts already belong to different PUBMAX accounts.",
      retryable: false,
    });
  });
});
