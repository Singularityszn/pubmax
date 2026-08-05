import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const fixture = vi.hoisted(() => ({
  configured: true,
  rows: {
    plans: [] as Row[],
    plan_stops: [] as Row[],
    plan_crew_members: [] as Row[],
    plan_actions: [] as Row[],
    plan_completions: [] as Row[],
  },
}));

function query(table: keyof typeof fixture.rows) {
  let rows = fixture.rows[table].map((row) => ({ ...row }));
  const builder = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      rows = rows.filter((row) => row[column] === value);
      return builder;
    },
    is(column: string, value: unknown) {
      rows = rows.filter((row) => row[column] === value);
      return builder;
    },
    order() {
      return builder;
    },
    async maybeSingle() {
      return { data: rows[0] ?? null, error: null };
    },
    then(resolve: (value: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => fixture.configured,
  requireSupabaseAdmin: () => ({
    from: (table: keyof typeof fixture.rows) => query(table),
  }),
}));

import {
  __resetMemoryPlans,
  memoryPlanStore,
  planStateResult,
  planCompletionResult,
  planMemberIdentityResult,
  socialBoundPlanStateResult,
  supabasePlanStore,
} from "@/lib/planStore";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

function seedBoundPlan(): void {
  fixture.rows.plans = [{
    id: PLAN_ID,
    title: "Bound night",
    start_time: "2026-08-05T19:00:00.000Z",
    created_at: "2026-08-05T12:00:00.000Z",
    status: "ready",
    route_revision: 1,
    night_context: null,
    ending: null,
    anchor_venue_id: null,
    anchor_source: null,
    plan_outcome: null,
    route_ready_at: null,
    social_owner_account_id: OWNER_ACCOUNT_ID,
  }];
  fixture.rows.plan_stops = [{
    plan_id: PLAN_ID,
    venue_id: "venue-one",
    venue_name: "Venue One",
    position: 0,
  }];
  fixture.rows.plan_crew_members = [{
    id: "33333333-3333-4333-8333-333333333333",
    plan_id: PLAN_ID,
    name: "Alice",
    status: "in",
    joined_at: "2026-08-05T12:00:00.000Z",
    updated_at: "2026-08-05T12:00:00.000Z",
  }];
  fixture.rows.plan_actions = [];
  fixture.rows.plan_completions = [{
    id: "44444444-4444-4444-8444-444444444444",
    plan_id: PLAN_ID,
    ending: "get_home",
    terminal_venue_id: null,
    ending_selection: null,
    final_pint_drop_id: null,
    route_revision: 1,
    route_snapshot: [],
    qualifying_arrival: null,
    completed_at: "2026-08-05T23:00:00.000Z",
  }];
}

beforeEach(() => {
  fixture.configured = true;
  seedBoundPlan();
  __resetMemoryPlans();
});

describe("legacy Plan boundary for Social Crews", () => {
  it("hides one Crew-bound Plan from central legacy reads", async () => {
    await expect(supabasePlanStore.get(PLAN_ID)).resolves.toBeNull();
    await expect(planStateResult(PLAN_ID)).resolves.toEqual({ ok: true, plan: null });
  });

  it("returns not found before every legacy Plan write can use a capability", async () => {
    await expect(supabasePlanStore.updatePresence(PLAN_ID, "old-token", "here"))
      .resolves.toEqual({ ok: false, error: "not_found" });
    await expect(supabasePlanStore.update(PLAN_ID, "old-token", {
      stops: [
        { venueId: "venue-one", venueName: "Venue One", position: 0 },
        { venueId: "venue-two", venueName: "Venue Two", position: 1 },
        { venueId: "venue-three", venueName: "Venue Three", position: 2 },
      ],
      expectedRouteRevision: 1,
    })).resolves.toEqual({ ok: false, error: "not_found" });
    await expect(supabasePlanStore.addAction(PLAN_ID, "old-token", {
      type: "arrived",
      stopPosition: 0,
      idempotencyKey: "legacy-action-key",
    })).resolves.toEqual({ ok: false, error: "not_found" });
    await expect(supabasePlanStore.complete(PLAN_ID, "old-token", {
      expectedRouteRevision: 1,
      ending: "get_home",
      endingSelection: {
        kind: "get_home",
        optionId: "tube",
        evidenceSnapshot: { label: "Tube", confidence: "high" },
      },
    })).resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("assembles a bound Plan only for its expected Social owner", async () => {
    const result = await socialBoundPlanStateResult(PLAN_ID, OWNER_ACCOUNT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan?.plan).toMatchObject({ id: PLAN_ID, title: "Bound night" });
    expect(result.plan?.stops).toEqual([
      { venueId: "venue-one", venueName: "Venue One", position: 0 },
    ]);
    expect(result.plan?.crew).toEqual([]);
    await expect(
      socialBoundPlanStateResult(
        PLAN_ID,
        "99999999-9999-4999-8999-999999999999",
      ),
    ).resolves.toEqual({ ok: true, plan: null });
  });

  it("makes legacy member identity and completion reads absent", async () => {
    await expect(planMemberIdentityResult(PLAN_ID, "old-token"))
      .resolves.toEqual({ ok: true, identity: null });
    await expect(planCompletionResult(PLAN_ID))
      .resolves.toEqual({ ok: true, completion: null });
  });

  it("never falls back to keyless Plan memory for a Social read", async () => {
    fixture.configured = false;
    const created = await memoryPlanStore.create({
      title: "Memory night",
      startTime: "2026-08-05T19:00:00.000Z",
      creatorName: "Alice",
      stops: [{ venueId: "venue-one", venueName: "Venue One", position: 0 }],
    });
    expect(created.ok).toBe(true);
    const memoryPlanId = created.ok ? created.plan.plan.id : PLAN_ID;

    await expect(
      socialBoundPlanStateResult(memoryPlanId, OWNER_ACCOUNT_ID),
    ).resolves.toEqual({ ok: false, error: "error" });
  });
});
