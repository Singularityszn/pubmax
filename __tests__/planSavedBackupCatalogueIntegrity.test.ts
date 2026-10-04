import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ packs: new Map<string, string>() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  readFile: async (file: unknown) => {
    const pack = fixture.packs.get(String(file));
    if (pack === undefined) throw new Error("Fixture catalogue unavailable");
    return pack;
  },
}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(), isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pintDrops")>(), isLimited: async () => false,
}));

function venue(suffix: string, changes: Record<string, unknown> = {}) {
  return { id: `venue-${suffix}`, name: `Canonical ${suffix}`, lat: 51.5, lng: -0.12,
    borough: "Camden", cheapestPrice: null, ...changes };
}
const storedStops = [
  { venueId: "venue-a", venueName: "Canonical a", alternatives: [{ venueId: "venue-d", venueName: "Canonical d" }] },
  { venueId: "venue-b", venueName: "Canonical b" }, { venueId: "venue-c", venueName: "Canonical c" },
];

beforeEach(async () => {
  vi.resetModules();
  fixture.packs.clear();
  const { CITIES } = await import("@/lib/cities");
  for (const city of Object.values(CITIES)) fixture.packs.set(`${process.cwd()}/public${city.slimVenuesPath}`, "[]");
  (await import("@/lib/planStore")).__resetMemoryPlans();
});
afterEach(async () => {
  (await import("@/lib/planStore")).__resetMemoryPlans();
  vi.restoreAllMocks();
});

describe("Saved backup recovery requires a complete canonical catalogue", () => {
  it.each([
    ["malformed pub", [venue("d", { lat: "51.5" })], false],
    ["cached malformed pub", [venue("d", { lat: "51.5" })], true],
    ["unknown kind", [venue("d", { kind: "unrecognised-kind" })], false],
    ["duplicate ID", [venue("a")], false],
  ] as const)("refuses a %s catalogue without changing saved Stops or revision", async (_, extraRows, warmCache) => {
    const { getCity } = await import("@/lib/cities");
    const file = `${process.cwd()}/public${getCity("london").slimVenuesPath}`;
    fixture.packs.set(file, JSON.stringify([venue("a"), venue("b"), venue("c"), ...extraRows]));
    if (warmCache) {
      const { loadConciergeVenues } = await import("@/lib/concierge/venues.server");
      expect((await loadConciergeVenues("london")).map((row) => row.id)).toEqual(["venue-a", "venue-b", "venue-c"]);
      // Recovery must read the same cached completeness as the rows, even if the file later changes.
      fixture.packs.set(file, JSON.stringify([venue("a"), venue("b"), venue("c"), venue("d")]));
    }
    const { memoryPlanStore } = await import("@/lib/planStore");
    const saved = await memoryPlanStore.create({ creatorName: "Host", startTime: "2026-09-30T19:00:00Z",
      stops: storedStops }, { idempotencyKey: "saved-backup-partially-malformed" });
    if (!saved.ok) throw new Error(`Could not seed stored Plan: ${saved.error}`);
    const { GET, PATCH } = await import("@/app/api/plans/[id]/route");
    const id = saved.plan.plan.id;
    const context = { params: Promise.resolve({ id }) };
    const response = await PATCH(new Request(`http://localhost/api/plans/${id}`, { method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${saved.memberToken}` },
      body: JSON.stringify({ expectedRouteRevision: 1, stops: storedStops }) }), context);
    const updated = await response.json();
    expect(response.status, JSON.stringify(updated)).toBe(400);
    expect(updated.code).toBe("PLAN_ROUTE_INVALID");
    const reloaded = await GET(new Request(`http://localhost/api/plans/${id}`, {
      headers: { authorization: `Bearer ${saved.memberToken}` },
    }), context);
    expect(reloaded.status).toBe(200);
    const state = await reloaded.json();
    expect(state.stops).toEqual(saved.plan.stops);
    expect(state.plan.routeRevision).toBe(1);
  });

  it("omits a truly missing saved backup when the complete catalogue deliberately excludes a declared bar", async () => {
    const { getCity } = await import("@/lib/cities");
    fixture.packs.set(`${process.cwd()}/public${getCity("london").slimVenuesPath}`,
      JSON.stringify([venue("a"), venue("b"), venue("c"), venue("e", { kind: "bar" })]));
    const { loadConciergeVenues } = await import("@/lib/concierge/venues.server");
    expect((await loadConciergeVenues("london")).map((row) => row.id)).toEqual(["venue-a", "venue-b", "venue-c"]);
    const { memoryPlanStore } = await import("@/lib/planStore");
    const saved = await memoryPlanStore.create({ creatorName: "Host", startTime: "2026-09-30T19:00:00Z",
      stops: storedStops }, { idempotencyKey: "saved-backup-declared-non-pub" });
    if (!saved.ok) throw new Error(`Could not seed stored Plan: ${saved.error}`);
    const { GET, PATCH } = await import("@/app/api/plans/[id]/route");
    const id = saved.plan.plan.id;
    const context = { params: Promise.resolve({ id }) };
    const response = await PATCH(new Request(`http://localhost/api/plans/${id}`, { method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${saved.memberToken}` },
      body: JSON.stringify({ expectedRouteRevision: 1, stops: storedStops }) }), context);
    const updated = await response.json();
    expect(response.status, JSON.stringify(updated)).toBe(200);
    expect(updated.stops).toEqual([
      { venueId: "venue-a", venueName: "Canonical a", position: 0 },
      { venueId: "venue-b", venueName: "Canonical b", position: 1 },
      { venueId: "venue-c", venueName: "Canonical c", position: 2 },
    ]);
    const reloaded = await GET(new Request(`http://localhost/api/plans/${id}`, {
      headers: { authorization: `Bearer ${saved.memberToken}` },
    }), context);
    expect(reloaded.status).toBe(200);
    const state = await reloaded.json();
    expect(state.stops).toEqual(updated.stops);
    expect(state.plan.routeRevision).toBe(2);
  });
});
