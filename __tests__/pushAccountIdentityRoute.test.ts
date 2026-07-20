import { beforeEach, describe, expect, it, vi } from "vitest";

const { callerAuthSessionIdentityMock, getByUserIdMock } = vi.hoisted(() => ({
  callerAuthSessionIdentityMock: vi.fn<() => Promise<{ id: string; email: string | null; sessionId: string } | null>>(
    async () => ({ id: "user-a", email: "a@example.com", sessionId: "session-a" }),
  ),
  getByUserIdMock: vi.fn<(userId: string) => Promise<{ id: string; userId: string } | null>>(async (userId) => ({ id: "profile-a", userId })),
}));

vi.mock("@/lib/authServer", () => ({ callerAuthSessionIdentity: callerAuthSessionIdentityMock }));
vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({ getByUserId: getByUserIdMock }),
}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { DELETE, POST } from "@/app/api/push-tokens/account/route";
import {
  __resetMemoryPushTokens,
  memoryPushTokenStore,
} from "@/lib/pushTokenStore";

const URL = "http://localhost/api/push-tokens/account";

function request(method: "POST" | "DELETE", body: unknown): Request {
  return new Request(URL, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer verified-jwt" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  __resetMemoryPushTokens();
  callerAuthSessionIdentityMock.mockReset();
  callerAuthSessionIdentityMock.mockResolvedValue({ id: "user-a", email: "a@example.com", sessionId: "session-a" });
  getByUserIdMock.mockReset();
  getByUserIdMock.mockImplementation(async (userId: string) => ({ id: "profile-a", userId }));
  await memoryPushTokenStore.save({ token: "device-token", platform: "ios" });
});

describe("push account identity route", () => {
  it("requires a server-verified JWT", async () => {
    callerAuthSessionIdentityMock.mockResolvedValue(null);
    const response = await POST(request("POST", { token: "device-token", platform: "ios" }));
    expect(response.status).toBe(401);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
  });

  it("requires the authenticated account to have completed profile claim", async () => {
    getByUserIdMock.mockResolvedValue(null);
    const response = await POST(request("POST", { token: "device-token", platform: "ios" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "PUSH_ACCOUNT_CLAIM_REQUIRED" });
  });

  it("ignores a forged client user id and links only the verified caller", async () => {
    const response = await POST(request("POST", {
      token: "device-token",
      platform: "ios",
      userId: "attacker-chosen-user",
    }));
    expect(response.status).toBe(200);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toHaveLength(1);
    expect(await memoryPushTokenStore.listForAccount("attacker-chosen-user")).toEqual([]);
  });

  it("is idempotent for the verified owner", async () => {
    const body = { token: "device-token", platform: "ios" };
    expect((await POST(request("POST", body))).status).toBe(200);
    expect((await POST(request("POST", body))).status).toBe(200);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toHaveLength(1);
  });

  it("flattens missing and cross-account joins and never reassigns", async () => {
    await memoryPushTokenStore.linkAccount("device-token", "user-b", "session-b");
    const conflict = await POST(request("POST", { token: "device-token", platform: "ios" }));
    const missing = await POST(request("POST", { token: "other-device", platform: "ios" }));
    expect(conflict.status).toBe(409);
    expect(missing.status).toBe(409);
    expect(await conflict.json()).toEqual(await missing.json());
    expect(await memoryPushTokenStore.listForAccount("user-b")).toHaveLength(1);
  });

  it("wrong-owner and repeated unlink are indistinguishable no-ops", async () => {
    await memoryPushTokenStore.linkAccount("device-token", "user-b", "session-b");
    const first = await DELETE(request("DELETE", { token: "device-token", platform: "ios" }));
    const second = await DELETE(request("DELETE", { token: "device-token", platform: "ios" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, linked: false });
    expect(await second.json()).toEqual({ ok: true, linked: false });
    expect(await memoryPushTokenStore.listForAccount("user-b")).toHaveLength(1);
  });

  it("supports verified privacy unlink-all without deleting public registration", async () => {
    await memoryPushTokenStore.linkAccount("device-token", "user-a", "session-a");
    const response = await DELETE(request("DELETE", { all: true, userId: "user-b" }));
    expect(response.status).toBe(200);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
    expect(await memoryPushTokenStore.list()).toHaveLength(1);
  });

  it("blocks a delayed POST from the logged-out session but permits a fresh session", async () => {
    const body = { token: "device-token", platform: "ios" };
    expect((await POST(request("POST", body))).status).toBe(200);
    expect((await DELETE(request("DELETE", body))).status).toBe(200);
    expect((await POST(request("POST", body))).status).toBe(409);

    callerAuthSessionIdentityMock.mockResolvedValue({
      id: "user-a",
      email: "a@example.com",
      sessionId: "session-new",
    });
    expect((await POST(request("POST", body))).status).toBe(200);
  });
});
