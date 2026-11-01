import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(), isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/contributionIdentity.server", () => ({ resolveContributionIdentity: async () => ({ ok: false }) }));

import { POST } from "@/app/api/plans/[id]/actions/route";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";
import { planVisitedRevealPositions } from "@/lib/planPresentation";
import { planBeaconLocation } from "@/lib/planBeacon";

const stops = ["a", "b", "c"].map((venueId, position) => ({ venueId, venueName: `Pub ${venueId}`, position }));
beforeEach(() => __resetMemoryPlans());
afterEach(() => vi.unstubAllEnvs());
async function night() {
  const created = await memoryPlanStore.create({ title: "Tonight", startTime: new Date().toISOString(), creatorName: "Host", stops });
  if (!created.ok) throw new Error("Cannot create Plan");
  const id = created.plan.plan.id;
  const guest = await memoryPlanStore.join(id, "Guest", { collaborationAuthorized: true });
  if (!guest.ok) throw new Error("Cannot join Plan");
  const submit = (body: object, key = "queued-action") => POST(new Request(`http://localhost/api/plans/${id}/actions`, {
    method: "POST", headers: { authorization: `Bearer ${guest.memberToken}`, "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
  return { id, host: created.memberToken, guest: guest.memberToken, submit };
}

it.each(["arrived", "skipped"] as const)("refuses a queued %s for a pub replaced before delivery without changing state", async (type) => {
  const n = await night();
  expect((await memoryPlanStore.update(n.id, n.host, { expectedRouteRevision: 1, stops: [stops[0]!, { venueId: "d", venueName: "Pub d", position: 1 }, stops[2]!] })).ok).toBe(true);
  const before = await memoryPlanStore.get(n.id);
  expect((await n.submit({ type, stopPosition: 1, expectedRouteRevision: 1, venueId: "b" })).status).toBe(409);
  expect(await memoryPlanStore.get(n.id)).toEqual(before);
  expect((await n.submit({ type, stopPosition: 1, expectedRouteRevision: 2, venueId: "b" })).status).toBe(409);
  expect((await n.submit({ type, stopPosition: 1, expectedRouteRevision: 1, venueId: "d" })).status).toBe(409);
  expect((await n.submit({ type, stopPosition: 1, expectedRouteRevision: 2, venueId: "d" })).status).toBe(201);
  const state = (await memoryPlanStore.get(n.id))!;
  expect(state.actions).toHaveLength(1);
  expect(state.actions![0]).toMatchObject({ type, routeRevision: 2, venueId: "d" });
  expect(planVisitedRevealPositions(state)).toEqual([1]);
});

it("replays an accepted arrival after a safe revision and rejects a different binding with the same key", async () => {
  const n = await night();
  const body = { type: "arrived", stopPosition: 1, expectedRouteRevision: 1, venueId: "b" };
  expect((await n.submit(body)).status).toBe(201);
  expect((await memoryPlanStore.update(n.id, n.host, { expectedRouteRevision: 1, stops: [stops[0]!, stops[1]!, { venueId: "d", venueName: "Pub d", position: 2 }] })).ok).toBe(true);
  expect((await n.submit(body)).status).toBe(201);
  expect((await n.submit({ ...body, expectedRouteRevision: 2 })).status).toBe(409);
  const state = (await memoryPlanStore.get(n.id))!;
  expect(state.actions).toHaveLength(1);
  expect(state.actions![0]).toMatchObject({ routeRevision: 1, venueId: "b" });
  expect(planVisitedRevealPositions(state)).toEqual([1]);
  expect(planBeaconLocation(state, new Date()).current).toBeNull();
});

it("keeps legacy action retries compatible without treating them as bound venue evidence", async () => {
  const n = await night();
  const body = { type: "arrived", stopPosition: 1 };
  expect((await n.submit(body)).status).toBe(201);
  expect((await n.submit(body)).status).toBe(201);
  const state = (await memoryPlanStore.get(n.id))!;
  expect(state.actions).toHaveLength(1);
  const action = state.actions?.[0];
  if (!action) throw new Error("Expected a legacy arrival action");
  expect(action.routeRevision).toBeUndefined();
  expect(action.venueId).toBeUndefined();
  expect(planVisitedRevealPositions(state)).toEqual([]);
  expect(planBeaconLocation(state, new Date()).current).toBeNull();
});

it.each([{ expectedRouteRevision: 1 }, { venueId: "b" }, { expectedRouteRevision: 0, venueId: "b" }])("refuses incomplete action bindings", async (binding) => {
  const n = await night();
  expect((await n.submit({ type: "arrived", stopPosition: 1, ...binding })).status).toBe(400);
  expect((await memoryPlanStore.get(n.id))!.actions).toEqual([]);
});
