import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ requireSupabaseAdmin: () => ({ rpc }) }));
import { friendLocationOperation } from "@/lib/friendLocationService.server";
import type { SocialPostActor } from "@/lib/socialPostStore";
const actor = { accountId: "account", profileId: "profile", handle: "alice" } as SocialPostActor;
beforeEach(() => { rpc.mockReset(); });
it("fails closed on a successful older RPC response without durable generation authority", async () => {
  rpc.mockResolvedValue({ data: { ok: true, own: null, friends: [], mutuals: [] }, error: null });
  await expect(friendLocationOperation(actor, "read")).rejects.toMatchObject({ code: "unavailable" });
});
it("refuses invalid generation receipts and retains valid confirmed authority", async () => {
  for (const generation of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    rpc.mockResolvedValue({ data: { ok: true, own: null, generation }, error: null });
    await expect(friendLocationOperation(actor, "reconcile", { expectedGeneration: 0 })).rejects.toMatchObject({ code: "unavailable" });
  }
  rpc.mockResolvedValue({ data: { ok: true, own: null, generation: 4 }, error: null });
  await expect(friendLocationOperation(actor, "reconcile", { expectedGeneration: 3 })).resolves.toMatchObject({ generation: 4 });
});
it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined, () => "unsafe", { nested: () => "unsafe" }])(
  "refuses non-JSON input before sending a location request: %s", async (value) => {
    rpc.mockResolvedValue({ data: { ok: true, own: null, generation: 1 }, error: null });
    await expect(friendLocationOperation(actor, "reconcile", { expectedGeneration: 0, value }))
      .rejects.toMatchObject({ code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  },
);
it("fails closed on an array RPC receipt", async () => {
  rpc.mockResolvedValue({ data: [{ ok: true, own: null, generation: 1 }], error: null });
  await expect(friendLocationOperation(actor, "read")).rejects.toMatchObject({ code: "unavailable" });
});
