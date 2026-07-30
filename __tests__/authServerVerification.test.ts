import { beforeEach, describe, expect, it, vi } from "vitest";

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
