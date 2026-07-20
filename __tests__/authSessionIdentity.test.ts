import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ auth: { getUser } }),
}));

import { callerAuthSessionIdentity } from "@/lib/authServer";

function jwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function request(token: string): Request {
  return new Request("http://localhost/api/push-tokens/account", {
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({
    data: { user: { id: "user-a", email: "a@example.com" } },
    error: null,
  });
});

describe("callerAuthSessionIdentity", () => {
  it("returns account and session authority only after verifying the same JWT", async () => {
    const token = jwt({ session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    await expect(callerAuthSessionIdentity(request(token))).resolves.toEqual({
      id: "user-a",
      email: "a@example.com",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(getUser).toHaveBeenCalledWith(token);
  });

  it("fails closed when the verified JWT has no valid auth-session id", async () => {
    await expect(callerAuthSessionIdentity(request(jwt({ session_id: "forged" })))).resolves.toBeNull();
    await expect(callerAuthSessionIdentity(request(jwt({})))).resolves.toBeNull();
  });

  it("never decodes session authority from a JWT Supabase rejects", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    await expect(callerAuthSessionIdentity(request(jwt({
      session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })))).resolves.toBeNull();
  });
});
