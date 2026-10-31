import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { GET, PUT } from "@/app/api/plans/[id]/presentation/route";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";
import { planVisitedRevealPositions } from "@/lib/planPresentation";

beforeEach(() => __resetMemoryPlans());

async function night() {
  const result = await memoryPlanStore.create({
    title: "A mystery night", creatorName: "Host",
    startTime: new Date(Date.now() + 3_600_000).toISOString(),
    stops: [{ venueId: "one", venueName: "First pub", position: 0 }],
  });
  if (!result.ok) throw new Error("Could not create test Plan");
  const id = result.plan.plan.id;
  const guest = await memoryPlanStore.join(id, "Guest", { collaborationAuthorized: true });
  if (!guest.ok) throw new Error("Could not join test Plan");
  const context = { params: Promise.resolve({ id }) };
  const read = (token: string) => GET(new Request(`http://localhost/api/plans/${id}/presentation`, {
    headers: { authorization: `Bearer ${token}` },
  }), context);
  const set = (token: string, enabled: unknown, revision = 1) => PUT(new Request(`http://localhost/api/plans/${id}/presentation`, {
    method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ mysteryEnabled: enabled, expectedRouteRevision: revision }),
  }), context);
  return { id, host: result.memberToken, guest: guest.memberToken, read, set };
}

it("lets the host enable a shared mystery presentation without changing the route", async () => {
  const n = await night();
  const before = await memoryPlanStore.get(n.id);
  expect(await (await n.read(n.guest)).json()).toMatchObject({ mysteryEnabled: false, canEdit: false, routeRevision: 1 });
  expect((await n.set(n.host, true)).status).toBe(200);
  const guestRead = await n.read(n.guest);
  expect(guestRead.headers.get("cache-control")).toContain("no-store");
  expect(await guestRead.json()).toMatchObject({ mysteryEnabled: true, canEdit: false, routeRevision: 1 });
  expect(await memoryPlanStore.get(n.id)).toEqual(before);
});

it("refuses strangers, guest writes, stale routes, and malformed settings", async () => {
  const n = await night();
  expect((await n.read("outsider")).status).toBe(403);
  expect((await n.set(n.guest, true)).status).toBe(403);
  expect((await n.set(n.host, true, 9)).status).toBe(409);
  expect((await n.set(n.host, "yes")).status).toBe(400);
  expect(await (await n.read(n.host)).json()).toMatchObject({ mysteryEnabled: false });
});

it("keeps the preserved completed prefix revealed after the host changes later stops", async () => {
  const n = await night();
  const arrival = await memoryPlanStore.addAction(n.id, n.host, { type: "arrived", stopPosition: 0, idempotencyKey: "arrival-before-change" });
  expect(arrival.ok).toBe(true);
  const changed = await memoryPlanStore.update(n.id, n.host, { expectedRouteRevision: 1, stops: [
    { venueId: "one", venueName: "First pub", position: 0 }, { venueId: "two", venueName: "Second pub", position: 1 },
  ] });
  if (!changed.ok) throw new Error("Could not change later stops");
  expect(changed.plan.plan.routeRevision).toBe(2);
  expect(planVisitedRevealPositions(changed.plan)).toEqual([0]);
  expect(planVisitedRevealPositions({ ...changed.plan, actions: [{ ...changed.plan.actions![0]!, routeRevision: undefined }] })).toEqual([]);
});
