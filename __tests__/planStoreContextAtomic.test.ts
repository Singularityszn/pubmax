import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({ rpc: supabase.rpc, from: supabase.from }),
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

const HOST_JOINED_AT = "2026-08-15T12:00:00.000Z";
const CREW_COMMITTED_AT = "2026-08-15T12:05:00.000Z";
const CREW_COMMITTED_EVENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOST_STATE: PlanState = {
  ...STATE,
  crew: [{
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Host",
    status: "in",
    joinedAt: HOST_JOINED_AT,
    updatedAt: HOST_JOINED_AT,
  }],
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
    const fallbackArgs = supabase.rpc.mock.calls[1];
    expect(fallbackArgs[0]).toBe("create_plan_idempotent_atomic");
    expect(fallbackArgs[1]).not.toHaveProperty("p_context");
    expect(fallbackArgs[1]).toMatchObject({
      p_request_hash: supabase.rpc.mock.calls[0][1].p_request_hash,
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
});

describe("Supabase Plan join identity", () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
    supabase.rpc.mockImplementation(async (_name: string, args: { p_member_id?: string }) => ({
      data: {
        outcome: "joined",
        member_id: args.p_member_id,
        crew_committed_at: CREW_COMMITTED_AT,
        crew_committed_event_id: CREW_COMMITTED_EVENT_ID,
      },
      error: null,
    }));
    supabase.from.mockReset();
    supabase.from.mockImplementation(() => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        is: vi.fn(),
        maybeSingle: vi.fn(async () => ({ data: { id: HOST_STATE.plan.id }, error: null })),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.is.mockReturnValue(query);
      return query;
    });
    vi.useFakeTimers();
    vi.setSystemTime(HOST_JOINED_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the atomic member and crew commitment evidence", async () => {
    vi.spyOn(supabasePlanStore, "get").mockResolvedValue(HOST_STATE);

    const result = await supabasePlanStore.join(HOST_STATE.plan.id, "Guest", {
      idempotencyKey: "atomic-member-result",
    });

    expect(result).toMatchObject({
      ok: true,
      memberId: expect.any(String),
      crewCommittedAt: CREW_COMMITTED_AT,
      crewCommittedEventId: CREW_COMMITTED_EVENT_ID,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "join_plan_idempotent_with_crew_commitment_atomic",
      expect.objectContaining({ p_member_id: result.ok ? result.memberId : undefined }),
    );
  });

  it("does not derive threshold authority from client timestamp ordering", async () => {
    vi.spyOn(supabasePlanStore, "get").mockResolvedValue(HOST_STATE);

    await supabasePlanStore.join(HOST_STATE.plan.id, "Guest", {
      idempotencyKey: "atomic-joined-at-order",
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "join_plan_idempotent_with_crew_commitment_atomic",
      expect.objectContaining({
        p_joined_at: HOST_JOINED_AT,
      }),
    );
  });
});
