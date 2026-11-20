import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const edge = vi.hoisted(() => ({ read: null as unknown, failure: false, writes: 0, verified: true }));
vi.mock("@/lib/socialAccessServer", () => ({ requireVerifiedSocialActor: async () => edge.verified
  ? { ok: true, actor: { accountId: "a2500000-0000-4000-8000-000000000001", profileId: "a2500000-0000-4000-8000-000000000002", handle: "ana" } }
  : { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." } }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/supabase", async original => ({ ...await original<typeof import("@/lib/supabase")>(),
  requireDynamicSupabaseAdmin: () => ({ rpc: async (name: string) => {
    if (edge.failure) return { error: { message: "Private failure details" }, data: null };
    if (name === "read_social_crew_see_again") return { data: edge.read, error: null };
    if (name === "purge_expired_social_crew_see_again") return { data: { ok: true, deleted: 3 }, error: null };
    edge.writes++; return { data: { ok: true, incomingPrivateChoice: true }, error: null };
  } }),
}));
import { GET, POST } from "@/app/api/social/crews/[crewId]/see-again/route";
import { GET as expire } from "@/app/api/cron/expire-see-again/route";
const crewId = "a2500000-0000-4000-8000-000000000003", memberId = "a2500000-0000-4000-8000-000000000004";
const context = { params: Promise.resolve({ crewId }) };
const request = (body?: Record<string, unknown>) => new Request(`http://localhost/api/social/crews/${crewId}/see-again`, {
  method: body ? "POST" : "GET", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
});
const payload = { memberId, context: "friendship", action: "choose", consent: true };
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  edge.verified = true; edge.read = null; edge.failure = false; edge.writes = 0;
});
afterEach(() => vi.unstubAllEnvs());
describe("private see-again routes", () => {
  it("refuses anonymous reads and writes without exposing any private data", async () => {
    edge.verified = false;
    for (const response of [await GET(request(), context), await POST(request(payload), context)]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "SOCIAL_SIGN_IN_REQUIRED" });
    }
    expect(edge.writes).toBe(0);
  });
  it("keeps absence neutral and storage failure unavailable, with private no-store responses", async () => {
    const missing = await GET(request(), context);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
    edge.failure = true;
    const failed = await GET(request(), context);
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("Private failure details");
  });
  it("returns only a neutral write acknowledgement and rejects absent consent and asserted identities", async () => {
    const accepted = await POST(request(payload), context);
    expect(await accepted.json()).toEqual({ ok: true });
    for (const body of [{ ...payload, consent: false }, { ...payload, actorId: "other" }, { ...payload, context: "inferred" }]) {
      expect((await POST(request(body), context)).status).toBe(422);
    }
    expect(edge.writes).toBe(1);
  });
  it("blocks new choices during freeze while reads and withdrawals retain their policy", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FREEZE", "social");
    expect((await POST(request(payload), context)).status).toBe(503);
    expect(edge.writes).toBe(0);
    expect((await GET(request(), context)).status).toBe(404);
    const withdrawn = await POST(request({ ...payload, action: "withdraw", consent: false }), context);
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toEqual({ ok: true });
  });
  it("authenticates expiry and makes sweep failure observable without private details", async () => {
    vi.stubEnv("CRON_SECRET", "private-fixture-cron-secret");
    const anonymous = await expire(new Request("http://localhost/api/cron/expire-see-again"));
    expect(anonymous.status).toBe(401);
    const signed = () => new Request("http://localhost/api/cron/expire-see-again", { headers: { Authorization: "Bearer private-fixture-cron-secret" } });
    expect(await (await expire(signed())).json()).toEqual({ ok: true, deleted: 3 });
    edge.failure = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await expire(signed());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ code: "SEE_AGAIN_EXPIRY_FAILED" });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
