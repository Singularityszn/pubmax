import { beforeEach, describe, expect, it, vi } from "vitest";

const durable = vi.hoisted(() => ({
  capabilityError: null as { code: string; message: string } | null,
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => ({
    rpc: durable.rpc,
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: durable.capabilityError }) }) }) }),
  }),
}));

import { __resetMemoryPlans, memoryPlanStore, supabasePlanStore } from "@/lib/planStore";

const stops = (ids: readonly string[]) => ids.map((venueId, position) => ({ venueId, venueName: venueId, position }));
const ending = { kind: "get_home" as const, optionId: "transport:nearest-station", evidenceSnapshot: { label: "Station", confidence: "unknown" as const } };

beforeEach(() => {
  __resetMemoryPlans();
  durable.capabilityError = null;
  durable.rpc.mockReset();
});

async function arrivedPlan(type: "arrived" | "skipped" = "arrived") {
  const created = await memoryPlanStore.create({
    title: "Venue identity", startTime: "2026-10-26T19:00:00Z", creatorName: "Host", stops: stops(["a", "b", "c"]),
  });
  if (!created.ok) throw new Error("Plan setup failed");
  const id = created.plan.plan.id;
  const token = created.memberToken;
  expect((await memoryPlanStore.addAction(id, token, { type, stopPosition: 0, idempotencyKey: "first-action" })).ok).toBe(true);
  return { id, token };
}

describe("Plan action venue identity", () => {
  it("rejects stale and missing route expectations after an edit, but preserves exact replay", async () => {
    const { id, token } = await arrivedPlan();
    await memoryPlanStore.update(id, token, { stops: stops(["d", "e", "f"]), expectedRouteRevision: 1 });
    for (const expectedRouteRevision of [undefined, 1]) {
      expect(await memoryPlanStore.addAction(id, token, { type: "arrived", stopPosition: 0, expectedRouteRevision, idempotencyKey: "stale-action" }))
        .toEqual({ ok: false, error: "conflict" });
    }
    expect((await memoryPlanStore.addAction(id, token, { type: "arrived", stopPosition: 0, idempotencyKey: "first-action" })).ok).toBe(true);
    expect((await memoryPlanStore.get(id))?.actions).toHaveLength(1);
  });

  it("upgrades provable revision-one history retained through HMR before a reorder", async () => {
    const { id, token } = await arrivedPlan();
    const state = (globalThis as typeof globalThis & {
      __pubmaxPlanMemory?: { plans: Map<string, { actions: Array<{ venueId?: string; routeRevision?: number }> }> };
    }).__pubmaxPlanMemory!.plans.get(id)!;
    delete state.actions[0]!.venueId;
    delete state.actions[0]!.routeRevision;
    await memoryPlanStore.update(id, token, { stops: stops(["c", "b", "a"]), expectedRouteRevision: 1 });
    const completed = await memoryPlanStore.complete(id, token, { expectedRouteRevision: 2, ending: "get_home", endingSelection: ending });
    expect(completed.ok && completed.completion.qualifyingArrival?.stopPosition).toBe(2);
  });

  it("refuses durable completion before identity columns exist instead of calling the unsafe RPC", async () => {
    const { id, token } = await arrivedPlan();
    durable.capabilityError = { code: "42703", message: "column venue_id does not exist" };
    expect(await supabasePlanStore.complete(id, token, { expectedRouteRevision: 1, ending: "get_home", endingSelection: ending }))
      .toEqual({ ok: false, error: "error" });
    expect(durable.rpc).not.toHaveBeenCalled();
  });

  it("keeps the existing durable completion signature after identity capability exists", async () => {
    const { id, token } = await arrivedPlan();
    durable.rpc.mockResolvedValue({ data: "arrival_required", error: null });
    expect(await supabasePlanStore.complete(id, token, { expectedRouteRevision: 1, ending: "get_home", endingSelection: ending }))
      .toEqual({ ok: false, error: "arrival_required" });
    expect(durable.rpc).toHaveBeenCalledWith("complete_plan_atomic", expect.objectContaining({ p_plan_id: id }));
  });

  it("does not transfer an arrival to a replacement pub or qualify completion", async () => {
    const { id, token } = await arrivedPlan();
    const edited = await memoryPlanStore.update(id, token, { stops: stops(["d", "e", "f"]), expectedRouteRevision: 1 });
    expect(edited.ok && edited.plan.actions?.[0]?.stopPosition).toBeNull();
    expect(await memoryPlanStore.complete(id, token, { expectedRouteRevision: 2, ending: "get_home", endingSelection: ending }))
      .toEqual({ ok: false, error: "arrival_required" });
    expect(await memoryPlanStore.getCompletion(id)).toBeNull();
  });

  it.each(["arrived", "skipped"] as const)("preserves %s history when the same pub moves", async (type) => {
    const { id, token } = await arrivedPlan(type);
    const edited = await memoryPlanStore.update(id, token, { stops: stops(["c", "b", "a"]), expectedRouteRevision: 1 });
    expect(edited.ok && edited.plan.actions?.[0]).toMatchObject({ type, stopPosition: 2 });
    if (!edited.ok) return;
    expect(edited.plan.actions?.[0]).not.toHaveProperty("venueId");
    expect(edited.plan.actions?.[0]).not.toHaveProperty("routeRevision");
    if (type === "arrived") {
      const result = await memoryPlanStore.complete(id, token, { expectedRouteRevision: 2, ending: "get_home", endingSelection: ending });
      expect(result.ok && result.completion.qualifyingArrival?.stopPosition).toBe(2);
    }
  });

  it("accepts a new arrival after replacement without reviving the removed pub", async () => {
    const { id, token } = await arrivedPlan();
    await memoryPlanStore.update(id, token, { stops: stops(["d", "e", "f"]), expectedRouteRevision: 1 });
    await memoryPlanStore.addAction(id, token, { type: "arrived", stopPosition: 1, expectedRouteRevision: 2, idempotencyKey: "new-arrival" });
    const result = await memoryPlanStore.complete(id, token, { expectedRouteRevision: 2, ending: "get_home", endingSelection: ending });
    expect(result.ok && result.completion.qualifyingArrival?.stopPosition).toBe(1);
    const replay = await memoryPlanStore.complete(id, token, { expectedRouteRevision: 2, ending: "get_home", endingSelection: ending });
    expect(replay.ok && replay.created).toBe(false);
    expect(replay.ok && replay.completion).toEqual(result.ok && result.completion);
  });
});
