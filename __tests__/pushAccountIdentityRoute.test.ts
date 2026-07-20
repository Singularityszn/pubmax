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
import { MAX_PUSH_MUTATION_VERSION } from "@/lib/pushInstallation";

const URL = "http://localhost/api/push-tokens/account";
const INSTALLATION_ID = "00000000-0000-4000-8000-000000000047";
const OTHER_INSTALLATION_ID = "11111111-1111-4111-8111-111111111111";

function request(method: "POST" | "DELETE", body: unknown, mutationVersion = 1): Request {
  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? { installationId: INSTALLATION_ID, mutationVersion, ...body as Record<string, unknown> }
    : body;
  return new Request(URL, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer verified-jwt" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

beforeEach(async () => {
  __resetMemoryPushTokens();
  callerAuthSessionIdentityMock.mockReset();
  callerAuthSessionIdentityMock.mockResolvedValue({ id: "user-a", email: "a@example.com", sessionId: "session-a" });
  getByUserIdMock.mockReset();
  getByUserIdMock.mockImplementation(async (userId: string) => ({ id: "profile-a", userId }));
  await memoryPushTokenStore.save({ token: "device-token", platform: "ios", installationId: INSTALLATION_ID });
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

  it("rejects missing or non-monotonic client mutation authority", async () => {
    const response = await POST(request("POST", {
      token: "device-token",
      platform: "ios",
      mutationVersion: 0,
    }));
    expect(response.status).toBe(400);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
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
    await memoryPushTokenStore.linkAccount("device-token", "user-b", "session-b", INSTALLATION_ID, 1);
    const conflict = await POST(request("POST", { token: "device-token", platform: "ios" }));
    const missing = await POST(request("POST", { token: "other-device", platform: "ios" }));
    expect(conflict.status).toBe(409);
    expect(missing.status).toBe(409);
    expect(await conflict.json()).toEqual(await missing.json());
    expect(await memoryPushTokenStore.listForAccount("user-b")).toHaveLength(1);
  });

  it("wrong-owner and repeated unlink are indistinguishable no-ops", async () => {
    await memoryPushTokenStore.linkAccount("device-token", "user-b", "session-b", INSTALLATION_ID, 1);
    const first = await DELETE(request("DELETE", { token: "device-token", platform: "ios" }));
    const second = await DELETE(request("DELETE", { token: "device-token", platform: "ios" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, linked: false, mutationVersion: 1 });
    expect(await second.json()).toEqual({ ok: true, linked: false, mutationVersion: 1 });
    expect(await memoryPushTokenStore.listForAccount("user-b")).toHaveLength(1);
  });

  it("keeps foreign-owner installation unlink flat at MAX_SAFE_INTEGER", async () => {
    await memoryPushTokenStore.linkAccount(
      "device-token",
      "user-b",
      "session-b",
      INSTALLATION_ID,
      MAX_PUSH_MUTATION_VERSION,
    );
    const wrongOwner = await DELETE(request("DELETE", { installationOnly: true }, 1));
    const missing = await DELETE(request("DELETE", {
      installationOnly: true,
      installationId: OTHER_INSTALLATION_ID,
    }, 1));
    expect(wrongOwner.status).toBe(200);
    expect(await wrongOwner.json()).toEqual(await missing.json());
    expect(await memoryPushTokenStore.listForAccount("user-b")).toHaveLength(1);
  });

  it("returns a flat success while applying mixed-owner installation logout per row", async () => {
    for (const token of ["foreign-token", "new-session-token", "anonymous-token"]) {
      await memoryPushTokenStore.save({ token, platform: "ios", installationId: INSTALLATION_ID });
    }
    await memoryPushTokenStore.linkAccount("device-token", "user-a", "session-a", INSTALLATION_ID, 4);
    await memoryPushTokenStore.linkAccount(
      "foreign-token",
      "user-b",
      "session-b",
      INSTALLATION_ID,
      MAX_PUSH_MUTATION_VERSION,
    );
    await memoryPushTokenStore.linkAccount(
      "new-session-token",
      "user-a",
      "session-new",
      INSTALLATION_ID,
      MAX_PUSH_MUTATION_VERSION,
    );
    await memoryPushTokenStore.linkAccount(
      "anonymous-token",
      "user-z",
      "session-z",
      INSTALLATION_ID,
      MAX_PUSH_MUTATION_VERSION - 1,
    );
    await memoryPushTokenStore.unlinkAccount(
      "anonymous-token",
      "user-z",
      "session-z",
      INSTALLATION_ID,
      1,
    );

    const response = await DELETE(request("DELETE", { installationOnly: true }, 1));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, linked: false, mutationVersion: 5 });
    expect((await memoryPushTokenStore.listForAccount("user-a")).map((row) => row.token))
      .toEqual(["new-session-token"]);
    expect((await memoryPushTokenStore.listForAccount("user-b")).map((row) => row.token))
      .toEqual(["foreign-token"]);
    await expect(memoryPushTokenStore.linkAccount(
      "anonymous-token",
      "user-a",
      "session-a",
      INSTALLATION_ID,
      6,
    )).resolves.toBe("conflict");
  });

  it("supports verified privacy unlink-all without deleting public registration", async () => {
    await memoryPushTokenStore.linkAccount("device-token", "user-a", "session-a", INSTALLATION_ID, 1);
    const response = await DELETE(request("DELETE", { all: true, userId: "user-b" }));
    expect(response.status).toBe(200);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
    expect(await memoryPushTokenStore.list()).toHaveLength(1);
  });

  it("applies all-device authority per row without touching a mixed-in foreign owner", async () => {
    for (const token of ["foreign-token", "new-session-token", "anonymous-token"]) {
      await memoryPushTokenStore.save({ token, platform: "ios", installationId: INSTALLATION_ID });
    }
    await memoryPushTokenStore.linkAccount("device-token", "user-a", "session-a", INSTALLATION_ID, 4);
    await memoryPushTokenStore.linkAccount(
      "foreign-token",
      "user-b",
      "session-b",
      INSTALLATION_ID,
      MAX_PUSH_MUTATION_VERSION,
    );
    await memoryPushTokenStore.linkAccount(
      "new-session-token",
      "user-a",
      "session-new",
      INSTALLATION_ID,
      5,
    );
    await memoryPushTokenStore.linkAccount(
      "anonymous-token",
      "user-z",
      "session-z",
      INSTALLATION_ID,
      MAX_PUSH_MUTATION_VERSION - 1,
    );
    await memoryPushTokenStore.unlinkAccount(
      "anonymous-token",
      "user-z",
      "session-z",
      INSTALLATION_ID,
      1,
    );

    const response = await DELETE(request("DELETE", { all: true }, 1));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, linked: false, mutationVersion: 6 });
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
    expect((await memoryPushTokenStore.listForAccount("user-b")).map((row) => row.token))
      .toEqual(["foreign-token"]);
    await expect(memoryPushTokenStore.linkAccount(
      "anonymous-token",
      "user-a",
      "session-a",
      INSTALLATION_ID,
      7,
    )).resolves.toBe("conflict");
  });

  it("fences delayed same-session account links on another installation after unlink-all", async () => {
    await memoryPushTokenStore.save({
      token: "other-installation-token",
      platform: "ios",
      installationId: OTHER_INSTALLATION_ID,
    });

    const response = await DELETE(request("DELETE", { all: true }, 2));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, linked: false, mutationVersion: 2 });
    await expect(memoryPushTokenStore.linkAccount(
      "other-installation-token",
      "user-a",
      "session-a",
      OTHER_INSTALLATION_ID,
      1,
    )).resolves.toBe("conflict");
    await expect(memoryPushTokenStore.linkAccount(
      "other-installation-token",
      "user-a",
      "session-new",
      OTHER_INSTALLATION_ID,
      1,
    )).resolves.toBe("linked");
  });

  it("blocks a delayed POST from the logged-out session but permits a fresh session", async () => {
    const body = { token: "device-token", platform: "ios" };
    expect((await POST(request("POST", body, 1))).status).toBe(200);
    expect((await DELETE(request("DELETE", body, 2))).status).toBe(200);
    expect((await POST(request("POST", body, 1))).status).toBe(409);

    callerAuthSessionIdentityMock.mockResolvedValue({
      id: "user-a",
      email: "a@example.com",
      sessionId: "session-new",
    });
    expect((await POST(request("POST", body, 3))).status).toBe(200);
  });

  it("does not let a stale old-session unlink clear or fence a newer session", async () => {
    const body = { token: "device-token", platform: "ios" };
    expect((await POST(request("POST", body, 10))).status).toBe(200);
    callerAuthSessionIdentityMock.mockResolvedValue({
      id: "user-a",
      email: "a@example.com",
      sessionId: "session-new",
    });
    expect((await POST(request("POST", body, 11))).status).toBe(200);

    callerAuthSessionIdentityMock.mockResolvedValue({
      id: "user-a",
      email: "a@example.com",
      sessionId: "session-a",
    });
    const staleUnlink = await DELETE(request("DELETE", { installationOnly: true }, 1));
    expect(await staleUnlink.json()).toEqual({ ok: true, linked: false, mutationVersion: 1 });
    expect(await memoryPushTokenStore.listForAccount("user-a")).toHaveLength(1);
    expect((await POST(request("POST", body, 12))).status).toBe(409);

    callerAuthSessionIdentityMock.mockResolvedValue({
      id: "user-a",
      email: "a@example.com",
      sessionId: "session-new",
    });
    expect((await POST(request("POST", body, 11))).status).toBe(200);
  });

  it("revokes by installation without recovering a raw provider token", async () => {
    const token = { token: "device-token", platform: "ios" };
    expect((await POST(request("POST", token, 1))).status).toBe(200);
    const revoked = await DELETE(request("DELETE", { installationOnly: true }, 2));
    expect(revoked.status).toBe(200);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
    expect((await POST(request("POST", token, 1))).status).toBe(409);
  });

  it("makes fresh DELETE-before-delayed-POST authoritative", async () => {
    const token = { token: "device-token", platform: "ios" };
    expect((await DELETE(request("DELETE", token, 2))).status).toBe(200);
    expect((await POST(request("POST", token, 1))).status).toBe(409);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
  });

  it("repairs a reset browser counter with a returned server watermark", async () => {
    const token = { token: "device-token", platform: "ios" };
    expect((await POST(request("POST", token, 10))).status).toBe(200);

    const revoked = await DELETE(request("DELETE", { installationOnly: true }, 1));
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ ok: true, linked: false, mutationVersion: 11 });
    expect(await memoryPushTokenStore.listForAccount("user-a")).toEqual([]);
    expect((await POST(request("POST", token, 10))).status).toBe(409);
  });

  it("fails closed when the server watermark cannot advance safely", async () => {
    await memoryPushTokenStore.linkAccount(
      "device-token",
      "user-a",
      "session-a",
      INSTALLATION_ID,
      MAX_PUSH_MUTATION_VERSION,
    );
    const response = await DELETE(request("DELETE", { installationOnly: true }, 1));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PUSH_ACCOUNT_UNLINK_UNAVAILABLE" });
    expect(await memoryPushTokenStore.listForAccount("user-a")).toHaveLength(1);
  });

  it("tombstones a missing-token DELETE before a delayed registration and POST", async () => {
    const deletion = await DELETE(request(
      "DELETE",
      { token: "not-yet-registered", platform: "ios" },
      2,
    ));
    expect(deletion.status).toBe(200);
    await memoryPushTokenStore.save({
      token: "not-yet-registered",
      platform: "ios",
      installationId: INSTALLATION_ID,
    });
    expect((await POST(request(
      "POST",
      { token: "not-yet-registered", platform: "ios" },
      1,
    ))).status).toBe(409);
  });

  it("keeps all-device cleanup atomic when any fence is exhausted", async () => {
    await memoryPushTokenStore.linkAccount("device-token", "user-a", "session-a", INSTALLATION_ID, 1);
    await memoryPushTokenStore.save({
      token: "exhausted-token",
      platform: "ios",
      installationId: OTHER_INSTALLATION_ID,
    });
    await memoryPushTokenStore.linkAccount(
      "exhausted-token",
      "user-a",
      "session-b",
      OTHER_INSTALLATION_ID,
      MAX_PUSH_MUTATION_VERSION,
    );
    const response = await DELETE(request("DELETE", { all: true }, 2));
    expect(response.status).toBe(503);
    expect(await memoryPushTokenStore.listForAccount("user-a")).toHaveLength(2);
  });
});
