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

const CONTEXT = {
  nightArea: "piccadilly-soho" as const,
  daypart: "evening" as const,
  partyType: "friends" as const,
  groupSize: 3,
  stopCount: 3 as const,
  budget: "value" as const,
  budgetLimitPence: null,
  zeroProof: false,
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
});
