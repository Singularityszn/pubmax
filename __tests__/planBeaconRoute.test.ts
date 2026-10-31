import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));

import { DELETE, GET, PUT } from "@/app/api/plans/[id]/beacon/route";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";

const NOW = new Date("2026-10-31T19:00:00.000Z");
const STOPS = [
  { venueId: "venue-first", venueName: "The First Pub", position: 0 },
  { venueId: "venue-next", venueName: "The Next Pub", position: 1 },
];

beforeEach(() => {
  vi.setSystemTime(NOW);
  __resetMemoryPlans();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function night() {
  const created = await memoryPlanStore.create({ title: "Our night", startTime: NOW.toISOString(), creatorName: "Host", stops: STOPS });
  if (!created.ok) throw new Error("Could not create the test plan.");
  const id = created.plan.plan.id;
  const joined = await memoryPlanStore.join(id, "Guest", { collaborationAuthorized: true });
  if (!joined.ok) throw new Error("Could not join the test plan.");
  const arrived = await memoryPlanStore.addAction(id, created.memberToken, { type: "arrived", stopPosition: 0, idempotencyKey: "beacon-arrival-one" });
  if (!arrived.ok) throw new Error("Could not record the test arrival.");
  return { id, host: created.memberToken, guest: joined.memberToken, arrivalId: arrived.plan.actions!.at(-1)!.id };
}

function request(id: string, token: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost/api/plans/${id}/beacon`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function context(id: string) { return { params: Promise.resolve({ id }) }; }

describe("Find our table through the private plan route", () => {
  it("lets the host set a current-pub beacon that an authorised member can read", async () => {
    const { id, host, guest, arrivalId } = await night();
    const written = await PUT(request(id, host, "PUT", {
      symbol: "star", note: "Upstairs, by the window", expectedRouteRevision: 1, expectedArrivalId: arrivalId,
    }), context(id));
    expect(written.status).toBe(200);
    const read = await GET(request(id, guest), context(id));
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect(await read.json()).toMatchObject({
      visibility: "member", canEdit: false,
      current: { venueId: "venue-first", venueName: "The First Pub" },
      next: { venueId: "venue-next", venueName: "The Next Pub" },
      beacon: { symbol: "star", note: "Upstairs, by the window", expiresAt: "2026-10-31T21:00:00.000Z" },
    });
  });

  it("returns the same refusal for missing plans and invalid member capabilities", async () => {
    const { id } = await night();
    const missing = "11111111-1111-4111-8111-111111111111";
    const first = await GET(request(id, "not-a-member"), context(id));
    const second = await GET(request(missing, "not-a-member"), context(missing));
    expect(first.status).toBe(404);
    expect(await first.text()).toBe(await second.text());
  });

  it("rejects a name-only guest at the read door and a crew member at the write door", async () => {
    const { id, guest, arrivalId } = await night();
    const joined = await memoryPlanStore.join(id, "Name only");
    if (!joined.ok) throw new Error("Could not create a name-only guest.");
    expect((await GET(request(id, joined.memberToken), context(id))).status).toBe(404);
    const response = await PUT(request(id, guest, "PUT", {
      symbol: "moon", note: "Near the door", expectedRouteRevision: 1, expectedArrivalId: arrivalId,
    }), context(id));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("venue-first");
  });

  it("does not accept a beacon at a guessed or previous arrival", async () => {
    const { id, host } = await night();
    const response = await PUT(request(id, host, "PUT", {
      symbol: "star", note: "Upstairs", expectedRouteRevision: 1, expectedArrivalId: "00000000-0000-4000-8000-000000000001",
    }), context(id));
    expect(response.status).toBe(409);
    expect(await (await GET(request(id, host), context(id))).json()).toMatchObject({ beacon: null });
  });

  it("rejects notes over 160 characters and symbols outside the closed set", async () => {
    const { id, host, arrivalId } = await night();
    for (const body of [{ symbol: "star", note: "x".repeat(161) }, { symbol: "flashing", note: "Upstairs" }]) {
      const response = await PUT(request(id, host, "PUT", { ...body, expectedRouteRevision: 1, expectedArrivalId: arrivalId }), context(id));
      expect(response.status).toBe(400);
    }
    expect(await (await GET(request(id, host), context(id))).json()).toMatchObject({ beacon: null });
  });

  it("does not renew a sign when the same PUT is retried", async () => {
    const { id, host, arrivalId } = await night();
    const body = { symbol: "circle", note: "By the window", expectedRouteRevision: 1, expectedArrivalId: arrivalId };
    const first = await (await PUT(request(id, host, "PUT", body), context(id))).json();
    vi.setSystemTime(new Date("2026-10-31T19:05:00.000Z"));
    const retried = await (await PUT(request(id, host, "PUT", body), context(id))).json();
    expect(retried.beacon.expiresAt).toBe(first.beacon.expiresAt);
  });

  it("hides the old sign when the crew skips the next pub", async () => {
    const { id, host, guest, arrivalId } = await night();
    await PUT(request(id, host, "PUT", { symbol: "star", note: "Upstairs", expectedRouteRevision: 1, expectedArrivalId: arrivalId }), context(id));
    vi.setSystemTime(new Date("2026-10-31T19:01:00.000Z"));
    await memoryPlanStore.addAction(id, host, { type: "skipped", stopPosition: 1, idempotencyKey: "beacon-skip-next" });
    expect(await (await GET(request(id, guest), context(id))).json()).toMatchObject({ beacon: null, current: null });
  });

  it("expires the sign after two hours and lets the host remove it sooner", async () => {
    const { id, host, arrivalId } = await night();
    const body = { symbol: "diamond", note: "Near the stairs", expectedRouteRevision: 1, expectedArrivalId: arrivalId };
    await PUT(request(id, host, "PUT", body), context(id));
    expect((await DELETE(request(id, host, "DELETE", body), context(id))).status).toBe(200);
    expect(await (await GET(request(id, host), context(id))).json()).toMatchObject({ beacon: null });
    await PUT(request(id, host, "PUT", body), context(id));
    vi.setSystemTime(new Date("2026-10-31T21:00:00.000Z"));
    expect(await (await GET(request(id, host), context(id))).json()).toMatchObject({ beacon: null });
  });


  it("does not attach a previous arrival to a replaced route", async () => {
    const { id, host, arrivalId } = await night();
    await PUT(request(id, host, "PUT", { symbol: "star", note: "Upstairs", expectedRouteRevision: 1, expectedArrivalId: arrivalId }), context(id));
    const forbidden = await memoryPlanStore.update(id, host, {
      expectedRouteRevision: 1,
      stops: [{ venueId: "venue-replacement", venueName: "Another Pub", position: 0 }, STOPS[1]!],
    });
    expect(forbidden).toMatchObject({ ok: false, error: "forbidden" });
    const replacement = await memoryPlanStore.update(id, host, {
      expectedRouteRevision: 1,
      stops: [STOPS[0]!, { venueId: "venue-replacement", venueName: "Another Pub", position: 1 }],
    });
    expect(replacement.ok).toBe(true);
    expect(await (await GET(request(id, host), context(id))).json()).toMatchObject({ beacon: null, current: null });
    expect((await PUT(request(id, host, "PUT", { symbol: "star", note: "Upstairs", expectedRouteRevision: 2, expectedArrivalId: arrivalId }), context(id))).status).toBe(409);
  });

  it("clamps expiry to the existing scheduled night end", async () => {
    const { id, host, arrivalId } = await night();
    vi.setSystemTime(new Date("2026-11-01T02:30:00.000Z"));
    const response = await PUT(request(id, host, "PUT", { symbol: "moon", note: "Upstairs", expectedRouteRevision: 1, expectedArrivalId: arrivalId }), context(id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ beacon: { expiresAt: "2026-11-01T03:00:00.000Z" } });
    vi.setSystemTime(new Date("2026-11-01T03:00:00.000Z"));
    expect(await (await GET(request(id, host), context(id))).json()).toMatchObject({ beacon: null, current: null });
  });

  it("fails closed when production has no durable store", async () => {
    const { id, host } = await night();
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await GET(request(id, host), context(id));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/venue-first|Upstairs|The First Pub/);
  });

});
