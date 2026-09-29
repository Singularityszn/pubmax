import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { completeSocialCrewPlan } from "@/lib/socialCrewCompletionStore";

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

describe("Social Crew completion store", () => {
  it("passes verified account identity to the RPC and fetches its persisted completion", async () => {
    const completion = { planId: input.planId, id: "70000000-0000-4000-8000-000000000001" };
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
});
