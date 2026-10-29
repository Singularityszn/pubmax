import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({
  access: { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." } as Record<string, unknown>,
  rpc: vi.fn(),
}));
vi.mock("@/lib/socialAccessServer", () => ({ requireVerifiedSocialActor: async () => boundary.access }));
vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => ({ rpc: boundary.rpc }),
  hashActor: (value: string) => value,
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
import { GET } from "@/app/api/hosted-outings/route";
import { PATCH } from "@/app/api/hosted-outings/[id]/route";
const id = "70000000-0000-4000-8000-000000000001";
const actor = { accountId: "10000000-0000-4000-8000-000000000001", profileId: "20000000-0000-4000-8000-000000000001", handle: "adult" };
const context = { params: Promise.resolve({ id }) };
const request = (body: unknown) => new Request(`https://pubmaxxing.com/api/hosted-outings/${id}`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  boundary.rpc.mockReset();
  boundary.rpc.mockImplementation(() => { throw new Error("Unexpected durable request"); });
  boundary.access = { ok: true, actor };
  vi.stubEnv("PUBMAX_HOSTED_OUTINGS_ENROLLMENT_ENABLED", undefined);
});

afterEach(() => { vi.unstubAllEnvs(); });

describe("hosted outing API boundary", () => {
  it("requires a verified adult before any outing read", async () => {
    boundary.access = { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." };
    const response = await GET(new Request("https://pubmaxxing.com/api/hosted-outings"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to use Social.", code: "SOCIAL_SIGN_IN_REQUIRED", retryable: false });
    expect(boundary.rpc).not.toHaveBeenCalled();
  });
  it("refuses an account that did not pass the existing adult gate", async () => {
    boundary.access = { ok: false, status: 403, code: "SOCIAL_ADULT_VERIFICATION_REQUIRED", error: "Adult verification is needed for Social." };
    const response = await PATCH(request({ action: "join", pace: "easy", budgetPence: 2000 }), context);
    expect(response.status).toBe(403);
    expect(boundary.rpc).not.toHaveBeenCalled();
  });
  it("does not replace an unavailable durable store with a successful memory signup", async () => {
    boundary.rpc.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });
    const response = await PATCH(request({ action: "join", pace: "easy", budgetPence: 2000 }), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "HOSTED_UNAVAILABLE", retryable: true });
  });
  it("holds enrollment when the launch switch is absent even if the row was opened", async () => {
    boundary.rpc.mockResolvedValue({ data: { staff: false, moderationOwners: [], outings: [{
      id, venueConfirmed: true, moderatorActive: true, enrollmentEnabled: true,
      startsAt: "2099-01-01T18:00:00Z", status: "open",
    }] }, error: null });
    const response = await PATCH(request({ action: "join", pace: "easy", budgetPence: 2000 }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ENROLLMENT_DISABLED" });
    expect(boundary.rpc.mock.calls.every(([name]) => name === "read_hosted_outings")).toBe(true);
  });
  it("refuses caller-supplied identities and sensitive matching fields", async () => {
    const response = await PATCH(request({ action: "join", pace: "easy", budgetPence: 2000, profileId: actor.profileId, religion: "invented" }), context);
    expect(response.status).toBe(422);
    expect(boundary.rpc).not.toHaveBeenCalled();
  });
});


it("requires approval of the exact group shown to the operator", async () => {
  const first = "20000000-0000-4000-8000-000000000002";
  const second = "20000000-0000-4000-8000-000000000003";
  boundary.rpc.mockResolvedValue({ data: { staff: true, moderationOwners: [], outings: [{
    id, operator: true, revision: 4, capacity: 2, blockedPairs: [], candidates: [
      { profileId: first, joinedAt: "2026-10-29T12:00:00Z", pace: "easy", budgetPence: 2000, state: "waiting" },
      { profileId: second, joinedAt: "2026-10-29T12:01:00Z", pace: "easy", budgetPence: 2000, state: "waiting" },
    ],
  }] }, error: null });
  const response = await PATCH(request({ action: "approve", revision: 4, profileIds: [first, "20000000-0000-4000-8000-000000000004"] }), context);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "HOSTED_STALE" });
  expect(boundary.rpc.mock.calls.every(([name]) => name === "read_hosted_outings")).toBe(true);
});
