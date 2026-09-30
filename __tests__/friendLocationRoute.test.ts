import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ access: { ok: true, actor: { accountId: "account", profileId: "profile", handle: "alice" } } as unknown, limited: false, operation: vi.fn(), purge: vi.fn() }));
vi.mock("@/lib/socialAccessServer", () => ({ requireVerifiedSocialActor: async () => state.access }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => state.limited }));
vi.mock("@/lib/supabase", () => ({ hashActor: (id: string) => id, requireSupabaseAdmin: () => ({ rpc: state.purge }) }));
vi.mock("@/lib/friendLocationService.server", () => ({ FriendLocationError: class extends Error {}, friendLocationOperation: state.operation }));
import { DELETE, GET, PATCH, POST } from "@/app/api/friend-locations/route";
import { GET as purge } from "@/app/api/cron/purge-friend-locations/route";
const recipient = "10000000-0000-4000-8000-000000000001";
const point = { latitude: 51.5, longitude: -0.1, accuracy: 12, expectedGeneration: 0 };
const request = (method: string, body?: unknown, headers = {}) => new Request("https://pubmax.test/api/friend-locations", { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => { state.limited = false; state.access = { ok: true, actor: { accountId: "account", profileId: "profile", handle: "alice" } }; state.operation.mockReset().mockResolvedValue({ ok: true, own: null, mutuals: [], friends: [] }); state.purge.mockReset().mockResolvedValue({ data: 2, error: null }); });
afterEach(() => vi.unstubAllEnvs());
describe("friend location API", () => {
  it("authenticates reads and keeps successes and refusals private no-store", async () => {
    expect((await GET(request("GET"))).headers.get("Cache-Control")).toBe("private, no-store");
    state.access = { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in." };
    const response = await GET(request("GET"));
    expect(response.status).toBe(401); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).not.toHaveProperty("friends");
  });
  it("refuses cross-site cookies, invalid coordinates, extra identity fields and excess recipients", async () => {
    expect((await POST(request("POST", { ...point, recipients: [recipient] }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    for (const body of [{ ...point, latitude: 91, recipients: [recipient] }, { ...point, recipients: [recipient], owner: "victim" }, { ...point, recipients: Array(21).fill(recipient) }]) {
      expect((await POST(request("POST", body))).status).toBe(422);
    }
    expect(state.operation).not.toHaveBeenCalled();
  });
  it("requires session plus revision for update and revoke; rate limits writes", async () => {
    expect((await PATCH(request("PATCH", point))).status).toBe(422);
    expect((await DELETE(request("DELETE", { sessionId: recipient }))).status).toBe(422);
    state.limited = true;
    expect((await POST(request("POST", { ...point, recipients: [recipient] }))).status).toBe(429);
    expect(state.operation).not.toHaveBeenCalled();
  });
  it("sends only verified server actor to service", async () => {
    const body = { ...point, recipients: [recipient] };
    expect((await POST(request("POST", body))).status).toBe(200);
    expect(state.operation).toHaveBeenCalledWith({ accountId: "account", profileId: "profile", handle: "alice" }, "start", body);
  });
  it("reconciles only bounded generations through the authenticated private mutation door", async () => {
    const body = { action: "reconcile", expectedGeneration: 4 };
    const response = await POST(request("POST", body));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.operation).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account" }), "reconcile", body);
    state.operation.mockClear();
    for (const invalid of [{ action: "reconcile" }, { ...body, latitude: 51 }, { ...body, expectedGeneration: -1 }, { ...body, expectedGeneration: 1.5 }, { ...body, expectedGeneration: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect((await POST(request("POST", invalid))).status).toBe(422);
    }
    expect((await POST(request("POST", body, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(state.operation).not.toHaveBeenCalled();
  });
});

describe("friend location physical retention", () => {
  it("refuses missing or wrong cron credentials before touching the private store", async () => {
    vi.stubEnv("CRON_SECRET", "friend-location-disposable-cron-secret");
    for (const headers of [{}, { authorization: "Bearer wrong" }]) {
      const response = await purge(request("GET", undefined, headers));
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(state.purge).not.toHaveBeenCalled();
  });
  it("purges with valid credential and hides database failure details", async () => {
    vi.stubEnv("CRON_SECRET", "friend-location-disposable-cron-secret");
    const cronRequest = () => request("GET", undefined, { authorization: "Bearer friend-location-disposable-cron-secret" });
    const success = await purge(cronRequest());
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ ok: true, removed: 2 });
    expect(state.purge).toHaveBeenCalledWith("purge_friend_locations");
    state.purge.mockResolvedValue({ data: null, error: { message: "private database details" } });
    const failed = await purge(cronRequest());
    expect(failed.status).toBe(503);
    expect(failed.headers.get("Cache-Control")).toBe("no-store");
    expect(await failed.text()).not.toContain("private database details");
  });
});
