import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { completeSocialCrewPlan } from "@/lib/socialCrewCompletionStore";
import type { PlanCompletionDTO } from "@/lib/plan";

const input = {
  actorAccountId: "10000000-0000-4000-8000-000000000001",
  crewId: "50000000-0000-4000-8000-000000000001",
  planId: "60000000-0000-4000-8000-000000000001",
  expectedRouteRevision: 1,
  arrivedStopPosition: 0,
  ending: "get_home" as const,
  terminalVenueId: null,
  endingSelection: {
    kind: "get_home" as const,
    optionId: "transport:home",
    evidenceSnapshot: {
      label: "Home",
      confidence: "unknown" as const,
      source: "PUBMAXX transport choice",
      warnings: [],
    },
  },
};

const completion: PlanCompletionDTO = {
  id: "70000000-0000-4000-8000-000000000001",
  planId: input.planId,
  ending: "get_home",
  terminalVenueId: null,
  endingSelection: input.endingSelection,
  finalPintDropId: null,
  routeRevision: 1,
  routeSnapshot: [{ venueId: "social-pub", venueName: "Social Pub", position: 0 }],
  qualifyingArrival: null,
  completedAt: "2030-03-06T21:00:00.000Z",
};

describe("Social Crew completion store", () => {
  it("passes verified account identity to the RPC and fetches its persisted completion", async () => {
    const rpc = vi.fn().mockResolvedValue("completed");
    const fetchCompletion = vi.fn().mockResolvedValue(completion);
    const result = await completeSocialCrewPlan(input, { rpc, completion: fetchCompletion });
    expect(result).toEqual({ completion, created: true });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
      p_actor_account_id: input.actorAccountId,
      p_crew_id: input.crewId,
      p_arrived_stop_position: 0,
    }));
    expect(fetchCompletion).toHaveBeenCalledWith(input.planId);
  });

  it("keeps RPC denials from returning a completion", async () => {
    const fetchCompletion = vi.fn();
    await expect(completeSocialCrewPlan(input, {
      rpc: vi.fn().mockResolvedValue("not_found"), completion: fetchCompletion,
    })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(fetchCompletion).not.toHaveBeenCalled();
  });


  it("returns the persisted completion on a replay without claiming another write", async () => {
    const result = await completeSocialCrewPlan(input, {
      rpc: vi.fn().mockResolvedValue("already_completed"),
      completion: vi.fn().mockResolvedValue(completion),
    });
    expect(result).toEqual({ completion, created: false });
  });

  it.each([
    ["conflict", "CONFLICT", 409],
    ["invalid", "INVALID", 422],
    ["unexpected", "UNAVAILABLE", 503],
  ] as const)("fails closed on %s without reading completion rows", async (result, code, status) => {
    const fetchCompletion = vi.fn();
    await expect(completeSocialCrewPlan(input, {
      rpc: vi.fn().mockResolvedValue(result), completion: fetchCompletion,
    })).rejects.toMatchObject({ code, status });
    expect(fetchCompletion).not.toHaveBeenCalled();
  });

  it("refuses a missing or different Plan completion after a successful RPC", async () => {
    for (const result of [null, { ...completion, planId: "another-plan" }]) {
      await expect(completeSocialCrewPlan(input, {
        rpc: vi.fn().mockResolvedValue("completed"), completion: vi.fn().mockResolvedValue(result),
      })).rejects.toMatchObject({ code: "UNAVAILABLE", status: 503 });
    }
  });
});
