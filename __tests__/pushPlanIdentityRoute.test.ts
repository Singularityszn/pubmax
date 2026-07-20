import { beforeEach, describe, expect, it, vi } from "vitest";

const { identityResultMock } = vi.hoisted(() => ({
  identityResultMock: vi.fn<() => Promise<
    | { ok: true; identity: { memberId: string; role: "guest"; collaborationAuthorized: boolean } | null }
    | { ok: false; error: "error" }
  >>(async () => ({
    ok: true as const,
    identity: { memberId: "11111111-1111-4111-8111-111111111111", role: "guest" as const, collaborationAuthorized: true },
  })),
}));

vi.mock("@/lib/planStore", () => ({ planMemberIdentityResult: identityResultMock }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { DELETE, POST } from "@/app/api/plans/[id]/push-tokens/route";
import { __resetMemoryPushTokens, memoryPushTokenStore } from "@/lib/pushTokenStore";

const PLAN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "22222222-2222-4222-8222-222222222222";
const INSTALLATION_ID = "00000000-0000-4000-8000-000000000047";
const context = { params: Promise.resolve({ id: PLAN_ID }) };

function request(method: "POST" | "DELETE", body: unknown, capability = "member-capability", mutationVersion = 1): Request {
  return new Request(`http://localhost/api/plans/${PLAN_ID}/push-tokens`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(capability ? { authorization: `Bearer ${capability}` } : {}),
    },
    body: JSON.stringify({ installationId: INSTALLATION_ID, mutationVersion, ...body as Record<string, unknown> }),
  });
}

beforeEach(async () => {
  __resetMemoryPushTokens();
  identityResultMock.mockReset();
  identityResultMock.mockResolvedValue({
    ok: true,
    identity: { memberId: MEMBER_A, role: "guest", collaborationAuthorized: true },
  });
  await memoryPushTokenStore.save({ token: "device-token", platform: "ios", installationId: INSTALLATION_ID });
});

describe("push Plan identity route", () => {
  it("requires a private member capability before token validation or storage", async () => {
    const response = await POST(request("POST", { token: "", platform: "ios" }, ""), context);
    expect(response.status).toBe(401);
    expect(identityResultMock).not.toHaveBeenCalled();
    expect(await memoryPushTokenStore.listForPlan(PLAN_ID)).toEqual([]);
  });

  it("rejects a capability that does not resolve to an active member", async () => {
    identityResultMock.mockResolvedValue({ ok: true, identity: null });
    const response = await POST(request("POST", { token: "device-token", platform: "ios" }), context);
    expect(response.status).toBe(403);
    expect(await memoryPushTokenStore.listForPlan(PLAN_ID)).toEqual([]);
  });

  it("derives member identity server-side and ignores forged body member ids", async () => {
    const response = await POST(request("POST", {
      token: "device-token",
      platform: "ios",
      memberId: MEMBER_B,
      planId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }), context);
    expect(response.status).toBe(200);
    expect(identityResultMock).toHaveBeenCalledWith(PLAN_ID, "member-capability");
    expect(await memoryPushTokenStore.listForPlan(PLAN_ID)).toHaveLength(1);
  });

  it("is idempotent for the same verified Plan member", async () => {
    const body = { token: "device-token", platform: "ios" };
    expect((await POST(request("POST", body), context)).status).toBe(200);
    expect((await POST(request("POST", body), context)).status).toBe(200);
    expect(await memoryPushTokenStore.listForPlan(PLAN_ID)).toHaveLength(1);
  });

  it("flattens missing and cross-member joins and never reassigns", async () => {
    await memoryPushTokenStore.linkPlan("device-token", PLAN_ID, MEMBER_B, INSTALLATION_ID, 1);
    const conflict = await POST(request("POST", { token: "device-token", platform: "ios" }), context);
    const missing = await POST(request("POST", { token: "other-device", platform: "ios" }), context);
    expect(conflict.status).toBe(409);
    expect(missing.status).toBe(409);
    expect(await conflict.json()).toEqual(await missing.json());

    await memoryPushTokenStore.unlinkPlan("device-token", PLAN_ID, MEMBER_B, INSTALLATION_ID, 2);
    expect(await memoryPushTokenStore.listForPlan(PLAN_ID)).toEqual([]);
  });

  it("makes wrong-member and repeated revocation indistinguishable", async () => {
    await memoryPushTokenStore.linkPlan("device-token", PLAN_ID, MEMBER_B, INSTALLATION_ID, 1);
    const first = await DELETE(request("DELETE", { token: "device-token", platform: "ios" }), context);
    const second = await DELETE(request("DELETE", { token: "device-token", platform: "ios" }), context);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, linked: false });
    expect(await second.json()).toEqual({ ok: true, linked: false });
    expect(await memoryPushTokenStore.listForPlan(PLAN_ID)).toHaveLength(1);
  });

  it("keeps DELETE intent when it reaches the server before an older POST", async () => {
    const body = { token: "device-token", platform: "ios" };
    expect((await DELETE(request("DELETE", body, "member-capability", 2), context)).status).toBe(200);
    expect((await POST(request("POST", body, "member-capability", 1), context)).status).toBe(409);
    expect(await memoryPushTokenStore.listForPlan(PLAN_ID)).toEqual([]);
  });
});
