import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const authState = vi.hoisted(() => ({
  identity: null as {
    id: string;
    email: string | null;
    createdAt: string | null;
  } | null,
}));
vi.mock("@/lib/authServer", () => ({
  callerAuthIdentity: async () => authState.identity,
}));

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", () => ({
  isLimited: async () => limitState.limited,
}));

const passwordGrant = vi.hoisted(() => vi.fn());
vi.mock("@/lib/handlePasswordSignIn", () => ({
  signInWithEmailPassword: passwordGrant,
}));

import { POST } from "@/app/api/auth/change-password/verify/route";

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/change-password/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "198.51.100.4",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authState.identity = {
    id: "user-1",
    email: "owner@example.com",
    createdAt: null,
  };
  limitState.limited = false;
  passwordGrant.mockReset();
});

describe("POST /api/auth/change-password/verify", () => {
  it("verifies the caller's own current password through the existing password seam", async () => {
    passwordGrant.mockResolvedValue({
      access_token: "temporary-access",
      refresh_token: "temporary-refresh",
    });

    const response = await POST(request({ currentPassword: "Oldpass1!" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: true });
    expect(passwordGrant).toHaveBeenCalledWith("owner@example.com", "Oldpass1!");
  });

  it("names a wrong current password only when GoTrue refused the password itself", async () => {
    passwordGrant.mockResolvedValue("invalid");

    const response = await POST(request({ currentPassword: "Wrongpass1!" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "CURRENT_PASSWORD_WRONG",
      error: "That is not your current password.",
    });
  });

  it("uses one generic failure for an upstream failure, a ban, short and missing passwords", async () => {
    passwordGrant.mockResolvedValueOnce(null).mockResolvedValueOnce("banned");

    const upstream = await POST(request({ currentPassword: "Rightpass1!" }));
    const banned = await POST(request({ currentPassword: "Rightpass1!" }));
    const short = await POST(request({ currentPassword: "short" }));
    const missing = await POST(request({}));

    const responses = [upstream, banned, short, missing];
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    for (const body of bodies) {
      expect(body).toEqual(bodies[0]);
      expect(body.code).toBe("INVALID_CREDENTIALS");
    }
    expect(passwordGrant).toHaveBeenCalledTimes(2);
  });

  it("never accepts a body account identity", async () => {
    passwordGrant.mockResolvedValue({
      access_token: "temporary-access",
      refresh_token: "temporary-refresh",
    });

    const response = await POST(
      request({
        userId: "someone-else",
        email: "someone-else@example.com",
        currentPassword: "Oldpass1!",
      }),
    );

    expect(response.status).toBe(200);
    expect(passwordGrant).toHaveBeenCalledWith("owner@example.com", "Oldpass1!");
  });

  it("requires a verified caller", async () => {
    authState.identity = null;

    const response = await POST(request({ currentPassword: "Oldpass1!" }));

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("INVALID_CREDENTIALS");
    expect(passwordGrant).not.toHaveBeenCalled();
  });

  it("rate limits verification attempts before calling Supabase Auth", async () => {
    limitState.limited = true;

    const response = await POST(request({ currentPassword: "Oldpass1!" }));

    expect(response.status).toBe(429);
    expect(passwordGrant).not.toHaveBeenCalled();
  });

  it("rejects cross-site requests", async () => {
    const response = await POST(
      request({ currentPassword: "Oldpass1!" }, { "sec-fetch-site": "cross-site" }),
    );

    expect(response.status).toBe(403);
    expect(passwordGrant).not.toHaveBeenCalled();
  });
});
