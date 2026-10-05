import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({ rpc: supabase.rpc }),
}));

import type { PlanState } from "@/lib/plan";
import { supabasePlanStore } from "@/lib/planStore";
import { defined } from "@/__tests__/helpers/defined";

const CONTEXT = {
  nightArea: "piccadilly-soho" as const,
  daypart: "evening" as const,
  partyType: "friends" as const,
  groupSize: 3,
  stopCount: 3 as const,
  budget: "value" as const,
  budgetLimitPence: null,
  zeroProof: false,
  drinkCategory: null,
  wetherspoonsPreferred: false,
  atmosphere: [],
  foodNeeds: [],
  accessibility: [],
  transportConstraints: [],
};

const STATE: PlanState = {
  plan: {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Tonight",
    startTime: "2026-08-15T19:00:00.000Z",
    createdAt: "2026-08-15T12:00:00.000Z",
    status: "draft",
  },
  stops: [
    { venueId: "venue-a", venueName: "A", position: 0 },
    { venueId: "venue-b", venueName: "B", position: 1 },
    { venueId: "venue-c", venueName: "C", position: 2 },
  ],
  crew: [],
  context: CONTEXT,
};

describe("Supabase Plan creation context", () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
    supabase.rpc.mockResolvedValue({ data: "created", error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Plan context through the single atomic create RPC", async () => {
    vi.spyOn(supabasePlanStore, "get").mockResolvedValue(STATE);

    const result = await supabasePlanStore.create({
      title: "Tonight",
      startTime: "2026-08-15T19:00:00.000Z",
      creatorName: "Host",
      stops: STATE.stops,
      context: CONTEXT,
    }, { idempotencyKey: "atomic-context-create" });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_plan_with_context_idempotent_atomic",
      expect.objectContaining({ p_context: CONTEXT }),
    );
  });

  it("still creates the Plan when migration 0106 has not been applied", async () => {
    vi.spyOn(supabasePlanStore, "get").mockResolvedValue({ ...STATE, context: null });
    supabase.rpc.mockReset();
    supabase.rpc.mockImplementation(async (fn: string) => (
      fn === "create_plan_with_context_idempotent_atomic"
        ? {
            data: null,
            error: {
              code: "PGRST202",
              message: "Could not find the function public.create_plan_with_context_idempotent_atomic in the schema cache",
            },
          }
        : { data: "created", error: null }
    ));

    const result = await supabasePlanStore.create({
      title: "Tonight",
      startTime: "2026-08-15T19:00:00.000Z",
      creatorName: "Host",
      stops: STATE.stops,
      context: CONTEXT,
    }, { idempotencyKey: "atomic-context-create" });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    const fallbackArgs = defined(supabase.rpc.mock.calls[1]);
    expect(fallbackArgs[0]).toBe("create_plan_idempotent_atomic");
    expect(fallbackArgs[1]).not.toHaveProperty("p_context");
    expect(fallbackArgs[1]).toMatchObject({
      p_request_hash: defined(supabase.rpc.mock.calls[0])[1].p_request_hash,
    });
  });

  it("reports a genuine RPC failure rather than retrying it unguarded", async () => {
    supabase.rpc.mockReset();
    supabase.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });

    const result = await supabasePlanStore.create({
      title: "Tonight",
      startTime: "2026-08-15T19:00:00.000Z",
      creatorName: "Host",
      stops: STATE.stops,
      context: CONTEXT,
    }, { idempotencyKey: "atomic-context-create-failure" });

    expect(result).toEqual({ ok: false, error: "error" });
    expect(supabase.rpc).toHaveBeenCalledOnce();
  });

  it("keeps durable create request hash stable when resolved price evidence changes", async () => {
    vi.spyOn(supabasePlanStore, "get").mockResolvedValue(STATE);
    const evidence = { category: "wine", pence: 750, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" } as const;
    const submittedStops = [{ venueId: "venue-a", venueName: "A", selectedDrinkPriceEvidence: evidence }];
    const base = { creatorName: "Host", startTime: STATE.plan.startTime, stops: submittedStops };
    const options = { idempotencyKey: "durable-evidence-retry", idempotencyStops: submittedStops };
    let originalHash: string | null = null;
    supabase.rpc.mockImplementation(async (_fn: string, args: { p_request_hash: string }) => {
      if (!originalHash) {
        originalHash = args.p_request_hash;
        return { data: "created", error: null };
      }
      return { data: args.p_request_hash === originalHash ? "replayed" : "conflict", error: null };
    });

    const first = await supabasePlanStore.create(base, options);
    const replay = await supabasePlanStore.create({ ...base, stops: [{ venueId: "venue-a", venueName: "A" }] }, options);
    expect(first.ok && first.created).toBe(true);
    expect(replay.ok && replay.created).toBe(false);
    expect(defined(supabase.rpc.mock.calls[0])[1].p_request_hash).toBe(defined(supabase.rpc.mock.calls[1])[1].p_request_hash);
    expect(defined(supabase.rpc.mock.calls[0])[1].p_stops).not.toEqual(defined(supabase.rpc.mock.calls[1])[1].p_stops);

    const changed = await supabasePlanStore.create(base, {
      ...options, idempotencyStops: [{ ...defined(submittedStops[0]), selectedDrinkPriceEvidence: { ...evidence, pence: 850 } }],
    });
    expect(changed).toEqual({ ok: false, error: "conflict" });
  });
});
