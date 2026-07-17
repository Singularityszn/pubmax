import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Plan completion has both durable and keyless backends. Pin this unit test to
// the keyless seam so Vercel credentials cannot turn it into a live database
// integration test during `npm run ci`.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
  };
});

// Route modules assert durable production configuration at import time. This
// suite deliberately exercises the keyless memory backend, so keep the runtime
// deployment guard outside the unit-test seam even when Vercel runs Vitest with
// VERCEL_ENV=production during a production build.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { POST as CREATE } from "@/app/api/plans/route";
import { GET as GET_PLAN } from "@/app/api/plans/[id]/route";
import { POST as ACTION } from "@/app/api/plans/[id]/actions/route";
import { GET as GET_COMPLETION, POST as COMPLETE } from "@/app/api/plans/[id]/complete/route";
import { __resetMemoryPlans } from "@/lib/planStore";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function createPlan() {
  const response = await CREATE(new Request("http://localhost/api/plans", {
    method: "POST",
    headers: { "idempotency-key": "plan-completion-create" },
    body: JSON.stringify({
      startTime: "2026-07-15T18:00:00.000Z",
      creatorName: "Terra",
      stops: [
        { venueId: "venue-xjf3n0" },
        { venueId: "venue-1f5ygjb" },
        { venueId: "venue-3h52h" },
      ],
    }),
  }));
  expect(response.status).toBe(201);
  return await response.json() as { plan: { plan: { id: string; routeRevision: number } }; memberToken: string };
}

beforeEach(() => __resetMemoryPlans());

describe("Plan Completion", () => {
  it("pins the durable RPC to the canonical host and an in-route arrival", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260716210000_0037_plan_completion_arrival.sql"), "utf8");
    expect(sql).toContain("order by joined_at, id limit 1");
    expect(sql).toContain("actor_id <> host_id");
    expect(sql).toContain("stop.position = action.stop_position");
    expect(sql).toContain("candidate.created_at <= completion.completed_at");
    expect(sql).toContain("on delete no action");
    expect(sql).toContain("deferrable initially deferred");
    expect(sql).toContain("not valid");
    expect(sql).toContain("validate constraint plan_completions_qualifying_arrival_shape");
    expect(sql).not.toContain("on delete set null");
    expect(sql).not.toContain("on delete cascade");
  });

  it("completes against the expected canonical route revision exactly once and redacts actor ids", async () => {
    const created = await createPlan();
    const id = created.plan.plan.id;
    const payload = { expectedRouteRevision: 1, ending: "food", terminalVenueId: "venue-3h52h" };
    const request = () => new Request(`http://localhost/api/plans/${id}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.memberToken}` },
      body: JSON.stringify(payload),
    });
    const beforeArrival = await COMPLETE(request(), ctx(id));
    expect(beforeArrival.status).toBe(400);
    expect(await beforeArrival.json()).toMatchObject({ code: "PLAN_ARRIVAL_REQUIRED" });

    const invalidArrival = await ACTION(new Request(`http://localhost/api/plans/${id}/actions`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.memberToken}`, "idempotency-key": "completion-arrival-invalid" },
      body: JSON.stringify({ type: "arrived", stopPosition: 7 }),
    }), ctx(id));
    expect(invalidArrival.status).toBe(400);

    const arrival = await ACTION(new Request(`http://localhost/api/plans/${id}/actions`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.memberToken}`, "idempotency-key": "completion-arrival-1" },
      body: JSON.stringify({ type: "arrived", stopPosition: 0 }),
    }), ctx(id));
    expect(arrival.status).toBe(201);

    const first = await COMPLETE(request(), ctx(id));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      plan: { plan: { status: "completed", routeRevision: 1 }, ending: "food" },
      created: true,
      completion: { planId: id, routeRevision: 1, qualifyingArrival: { stopPosition: 0 }, routeSnapshot: [
        { venueId: "venue-xjf3n0", position: 0 },
        { venueId: "venue-1f5ygjb", position: 1 },
        { venueId: "venue-3h52h", position: 2 },
      ] },
    });
    expect(firstBody.completion).not.toHaveProperty("actorMemberId");
    expect(JSON.stringify(firstBody)).not.toContain(created.memberToken);

    const retry = await COMPLETE(request(), ctx(id));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ created: false, completion: firstBody.completion });

    const get = await GET_COMPLETION(new Request(`http://localhost/api/plans/${id}/complete`), ctx(id));
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ completion: firstBody.completion });
  });

  it("rejects a stale route revision without recording a partial ending action or completion", async () => {
    const created = await createPlan();
    const id = created.plan.plan.id;
    const response = await COMPLETE(new Request(`http://localhost/api/plans/${id}/complete`, {
      method: "POST",
      body: JSON.stringify({ memberToken: created.memberToken, expectedRouteRevision: 2, ending: "food", terminalVenueId: "venue-3h52h" }),
    }), ctx(id));
    expect(response.status).toBe(409);

    const completion = await GET_COMPLETION(new Request(`http://localhost/api/plans/${id}/complete`), ctx(id));
    expect(await completion.json()).toEqual({ completion: null });
    const plan = await GET_PLAN(new Request(`http://localhost/api/plans/${id}`), ctx(id));
    expect(await plan.json()).toMatchObject({ plan: { status: "draft", routeRevision: 1 }, actions: [] });
  });
});
