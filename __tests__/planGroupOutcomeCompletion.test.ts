import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), scope: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requiresSupabaseStore: () => false,
  requireSupabaseAdmin: () => ({ rpc: fixtures.rpc, from: fixtures.from }),
}));
vi.mock("@/lib/analyticsAttribution.mjs", () => ({ currentAnalyticsAttribution: () => ({ environment: "production", release: "abcdef0" }) }));
vi.mock("@/lib/planGroupOutcomeScope.server", () => ({ planGroupOutcomeScope: fixtures.scope }));
import { hashPlanMemberToken, supabasePlanStore } from "@/lib/planStore";
import type { EndingSelection, PlanCompletionDTO, PlanState } from "@/lib/plan";

const id = "11111111-1111-4111-8111-111111111111";
const token = "fixture-host-token";
const selection: EndingSelection = { kind: "get_home", optionId: "walk", evidenceSnapshot: { label: "Walk", confidence: "high" } };
const state: PlanState = {
  plan: { id, title: "Fixture", startTime: "2020-02-04T12:00:00Z", createdAt: "2020-01-01T00:00:00Z", routeRevision: 3, status: "active" },
  stops: [{ venueId: "listed-london", venueName: "Fixture pub", position: 0 }], crew: [],
};
const completion: PlanCompletionDTO = {
  id: "22222222-2222-4222-8222-222222222222", planId: id, ending: "get_home", terminalVenueId: null,
  endingSelection: selection, finalPintDropId: null,
  routeRevision: 3, routeSnapshot: state.stops, qualifyingArrival: null, completedAt: "2020-02-04T12:00:00Z",
};

beforeEach(() => {
  fixtures.rpc.mockReset().mockResolvedValue({ data: "completed", error: null });
  fixtures.scope.mockReset().mockResolvedValue("london");
  fixtures.from.mockReset().mockImplementation((table: string) => {
    const result = { data: [{ id: "host-seat", token_hash: hashPlanMemberToken(token) }], error: null };
    const query = {
      select: () => query, eq: () => query, is: () => query, order: () => query,
      maybeSingle: async () => ({ data: table === "plans" ? { id } : null, error: null }),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  });
  vi.spyOn(supabasePlanStore, "get").mockResolvedValue(state);
  vi.spyOn(supabasePlanStore, "getCompletion").mockResolvedValue(completion);
});
afterEach(() => vi.restoreAllMocks());

it.each(["london", "unknown"])("passes server-derived %s evidence with the exact read revision and Stop IDs", async (scope) => {
  fixtures.scope.mockResolvedValue(scope);
  const result = await supabasePlanStore.complete(id, token, {
    expectedRouteRevision: 3, ending: "get_home", endingSelection: selection,
  });
  expect(result.ok).toBe(true);
  expect(fixtures.scope).toHaveBeenCalledWith(state.stops);
  expect(fixtures.rpc).toHaveBeenCalledWith("complete_plan_with_group_outcome_atomic", expect.objectContaining({
    p_scope_route_revision: 3, p_scope_venue_ids: ["listed-london"], p_route_scope: scope,
    p_environment: "production", p_release: "abcdef0",
  }));
  expect(fixtures.rpc.mock.calls[0][1]).not.toHaveProperty("p_excluded_user_ids");
});

it("passes the read revision separately from a newer expected revision", async () => {
  fixtures.rpc.mockResolvedValue({ data: "conflict", error: null });
  expect(await supabasePlanStore.complete(id, token, {
    expectedRouteRevision: 4, ending: "get_home", endingSelection: selection,
  })).toEqual({ ok: false, error: "conflict" });
  expect(fixtures.rpc.mock.calls[0][1]).toMatchObject({ p_expected_route_revision: 4, p_scope_route_revision: 3 });
});
