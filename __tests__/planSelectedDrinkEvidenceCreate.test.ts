import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listedBundleFixture = vi.hoisted(() => ({
  rows: null as import("@/lib/ukPriceBundle").UkPriceBundleRow[] | null,
  status: "ready" as "ready" | "empty" | "unavailable",
}));
vi.mock("@/lib/ukPriceBundle.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukPriceBundle.server")>();
  const { listedCategoryPrices } = await import("@/lib/listedCategoryPrices");
  return {
    ...actual,
    ukPriceBundleRowsFor: async (venueId: string) => listedBundleFixture.rows === null
      ? actual.ukPriceBundleRowsFor(venueId)
      : { status: listedBundleFixture.status, rows: listedBundleFixture.rows.filter((row) => row.venueId === venueId) },
    ukPriceBundleCategoryIndex: async (category: import("@/lib/drinks").DrinkCategory, now: number) => {
      if (listedBundleFixture.rows === null) return actual.ukPriceBundleCategoryIndex(category, now);
      const prices = [...new Set(listedBundleFixture.rows.map((row) => row.venueId))].flatMap((venueId) => {
        const quote = listedCategoryPrices(listedBundleFixture.rows!.filter((row) => row.venueId === venueId), now)
          .find((value) => value.category === category);
        return quote ? [{ venueId, ...quote }] : [];
      });
      return { prices, truncated: false, degraded: listedBundleFixture.status === "unavailable" };
    },
  };
});

const { categoryIndexMock } = vi.hoisted(() => ({ categoryIndexMock: vi.fn() }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});
vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: async () => [
    { id: "venue-a", name: "Venue A" },
    { id: "venue-b", name: "Venue B" },
    { id: "venue-c", name: "Venue C" },
  ],
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return { ...actual, readCommunityPriceCategoryIndex: categoryIndexMock };
});

import { POST } from "@/app/api/plans/route";
import { GET, PATCH } from "@/app/api/plans/[id]/route";
import { inferNightContext } from "@/lib/nightPlanning";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";
import { buildPlanPrivacyPreview } from "@/lib/planPrivacy";

let sequence = 0;

async function create(category: "wine" | "cocktail" | "beer", submitted: unknown) {
  const response = await POST(new Request("http://localhost/api/plans", {
    method: "POST",
    headers: { "idempotency-key": `selected-drink-${++sequence}`, "content-type": "application/json" },
    body: JSON.stringify({
      creatorName: "Host",
      startTime: "2026-09-30T19:00:00.000Z",
      context: { ...inferNightContext(category).context, nightArea: "piccadilly-soho", drinkCategory: category },
      stops: [{ venueId: "venue-a", venueName: "Forged name", selectedDrinkPriceEvidence: submitted }],
    }),
  }));
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(201);
  const reloaded = await memoryPlanStore.get(body.plan.plan.id);
  expect(reloaded).not.toBeNull();
  return { body, reloaded: reloaded! };
}

describe("Plan create selected drink evidence", () => {
  beforeEach(() => { __resetMemoryPlans(); categoryIndexMock.mockReset(); listedBundleFixture.rows = null; listedBundleFixture.status = "ready"; });
  afterEach(() => { __resetMemoryPlans(); listedBundleFixture.rows = null; });

  it.each(["wine", "cocktail"] as const)("saves trusted %s evidence on route replacement and reload", async (category) => {
    const { body } = await create(category, null);
    const submittedAt = Date.now();
    const evidence = { category, pence: 750, serving: null, source: "community", reportedAt: new Date(submittedAt).toISOString() };
    categoryIndexMock.mockResolvedValue({
      prices: [{ venueId: "venue-b", drinkCategory: category, priceGbp: 7.5, submittedAt, source: "community", corroborations: 2 }],
      degraded: false, truncated: false,
    });
    const response = await PATCH(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        expectedRouteRevision: 1,
        stops: [
          { venueId: "venue-a" },
          { venueId: "venue-b", selectedDrinkPriceEvidence: { ...evidence, contributor: "private" } },
          { venueId: "venue-c" },
        ],
      }),
    }), { params: Promise.resolve({ id: body.plan.plan.id }) });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.stops[1]?.selectedDrinkPriceEvidence).toEqual(evidence);
    expect((await memoryPlanStore.get(body.plan.plan.id))?.stops[1]?.selectedDrinkPriceEvidence).toEqual(evidence);
  });

  it("drops evidence if saved drink intent changes while replacement checks the price", async () => {
    const { body } = await create("wine", null);
    const submittedAt = Date.now();
    const evidence = { category: "wine", pence: 750, serving: null, source: "community", reportedAt: new Date(submittedAt).toISOString() };
    categoryIndexMock.mockImplementationOnce(async () => {
      const contextResponse = await PATCH(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json" },
        body: JSON.stringify({ context: { ...body.plan.context, drinkCategory: "beer" } }),
      }), { params: Promise.resolve({ id: body.plan.plan.id }) });
      expect(contextResponse.status).toBe(200);
      return { prices: [{ venueId: "venue-b", drinkCategory: "wine", priceGbp: 7.5, submittedAt, source: "community", corroborations: 2 }], degraded: false, truncated: false };
    });
    const response = await PATCH(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRouteRevision: 1, stops: [
        { venueId: "venue-a" }, { venueId: "venue-b", selectedDrinkPriceEvidence: evidence }, { venueId: "venue-c" },
      ] }),
    }), { params: Promise.resolve({ id: body.plan.plan.id }) });
    expect(response.status).toBe(200);
    const saved = await memoryPlanStore.get(body.plan.plan.id);
    expect(saved?.context?.drinkCategory).toBe("beer");
    expect(saved?.stops[1]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("omits mismatched and degraded replacement evidence", async () => {
    const submittedAt = Date.now();
    const evidence = { category: "wine", pence: 750, serving: null, source: "community", reportedAt: new Date(submittedAt).toISOString() };
    const submit = async (hint: unknown) => {
      const { body } = await create("wine", null);
      const response = await PATCH(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json" },
        body: JSON.stringify({ expectedRouteRevision: 1, stops: [
          { venueId: "venue-a" }, { venueId: "venue-b", selectedDrinkPriceEvidence: hint }, { venueId: "venue-c" },
        ] }),
      }), { params: Promise.resolve({ id: body.plan.plan.id }) });
      expect(response.status).toBe(200);
      return response.json();
    };
    categoryIndexMock.mockResolvedValue({
      prices: [{ venueId: "venue-b", drinkCategory: "wine", priceGbp: 7.5, submittedAt, source: "community", corroborations: 2 }],
      degraded: false, truncated: false,
    });
    expect((await submit({ ...evidence, pence: 100 })).stops[1]?.selectedDrinkPriceEvidence).toBeUndefined();
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: true, truncated: false });
    expect((await submit(evidence)).stops[1]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it.each(["wine", "cocktail"] as const)("saves and reloads trusted %s evidence without leaking it into preview", async (category) => {
    const submittedAt = Date.now();
    const evidence = { category, pence: 750, serving: null, source: "community", reportedAt: new Date(submittedAt).toISOString() };
    categoryIndexMock.mockResolvedValue({
      prices: [{ venueId: "venue-a", drinkCategory: category, priceGbp: 7.5, submittedAt, source: "community", corroborations: 2 }],
      degraded: false, truncated: false,
    });
    const { body, reloaded } = await create(category, { ...evidence, contributor: "private" });
    expect(body.plan.stops[0]).toEqual({ venueId: "venue-a", venueName: "Venue A", position: 0, selectedDrinkPriceEvidence: evidence });
    expect(reloaded.stops[0]?.selectedDrinkPriceEvidence).toEqual(evidence);
    expect(JSON.stringify(buildPlanPrivacyPreview(reloaded))).not.toContain("750");
  });

  it.each([
    { drinkCategory: "beer", zeroProof: false },
    { drinkCategory: "wine", zeroProof: true },
  ] as const)("clears saved wine evidence when Plan intent changes to $drinkCategory with zeroProof=$zeroProof", async (change) => {
    const submittedAt = Date.now();
    const evidence = { category: "wine", pence: 750, serving: null, source: "community", reportedAt: new Date(submittedAt).toISOString() };
    categoryIndexMock.mockResolvedValue({
      prices: [{ venueId: "venue-a", drinkCategory: "wine", priceGbp: 7.5, submittedAt, source: "community", corroborations: 2 }],
      degraded: false, truncated: false,
    });
    const { body } = await create("wine", evidence);
    expect(body.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(evidence);
    const sameIntent = await PATCH(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ context: { ...body.plan.context, budget: "treat" } }),
    }), { params: Promise.resolve({ id: body.plan.plan.id }) });
    expect(sameIntent.status).toBe(200);
    expect((await sameIntent.json()).stops[0]?.selectedDrinkPriceEvidence).toEqual(evidence);
    const response = await PATCH(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ context: { ...body.plan.context, ...change } }),
    }), { params: Promise.resolve({ id: body.plan.plan.id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    expect((await memoryPlanStore.get(body.plan.plan.id))?.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("omits forged, untrusted, degraded, and beer prices", async () => {
    const submittedAt = Date.now();
    const evidence = { category: "wine", pence: 750, serving: null, source: "community", reportedAt: new Date(submittedAt).toISOString() };
    categoryIndexMock.mockResolvedValue({
      prices: [{ venueId: "venue-a", drinkCategory: "wine", priceGbp: 7.5, submittedAt, source: "community", corroborations: 2 }],
      degraded: false, truncated: false,
    });
    expect((await create("wine", { ...evidence, pence: 100 })).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    expect((await create("wine", { ...evidence, reportedAt: new Date(submittedAt - 1000).toISOString() })).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    categoryIndexMock.mockResolvedValue({
      prices: [{ venueId: "venue-a", drinkCategory: "wine", priceGbp: 7.5, submittedAt, source: "community", corroborations: 1 }],
      degraded: false, truncated: false,
    });
    expect((await create("wine", evidence)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: false, truncated: false });
    expect((await create("wine", evidence)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    categoryIndexMock.mockResolvedValue({
      prices: [{ venueId: "venue-a", drinkCategory: "wine", priceGbp: 7.5, submittedAt, source: "community", corroborations: 2 }],
      degraded: true, truncated: false,
    });
    expect((await create("wine", evidence)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    categoryIndexMock.mockResolvedValue({
      prices: [{ venueId: "venue-a", drinkCategory: "wine", priceGbp: 7.5, submittedAt, source: "community", corroborations: 2 }],
      degraded: false, truncated: true,
    });
    expect((await create("wine", evidence)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    expect((await create("beer", evidence)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("replays the original wine Plan when trusted prices change after a lost response", async () => {
    const submittedAt = Date.now();
    const evidence = { category: "wine", pence: 750, serving: null, source: "community", reportedAt: new Date(submittedAt).toISOString() };
    const body = {
      creatorName: "Host",
      startTime: "2026-09-30T19:00:00.000Z",
      context: { ...inferNightContext("wine").context, nightArea: "piccadilly-soho", drinkCategory: "wine" },
      stops: [{ venueId: "venue-a", venueName: "Forged name", selectedDrinkPriceEvidence: evidence }],
    };
    const submit = async (value = body) => {
      const response = await POST(new Request("http://localhost/api/plans", {
        method: "POST",
        headers: { "idempotency-key": "selected-drink-retry-stable", "content-type": "application/json" },
        body: JSON.stringify(value),
      }));
      return { status: response.status, body: await response.json() };
    };
    categoryIndexMock.mockResolvedValueOnce({
      prices: [{ venueId: "venue-a", drinkCategory: "wine", priceGbp: 7.5, submittedAt, source: "community", corroborations: 2 }],
      degraded: false, truncated: false,
    });
    const first = await submit();
    expect(first.status).toBe(201);
    expect(first.body.plan.stops[0].selectedDrinkPriceEvidence).toEqual(evidence);
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: true, truncated: false });
    const replay = await submit();
    expect(replay.status).toBe(201);
    expect(replay.body.created).toBe(false);
    expect(replay.body.plan.plan.id).toBe(first.body.plan.plan.id);
    expect(replay.body.plan.stops[0].selectedDrinkPriceEvidence).toEqual(evidence);
    const changed = await submit({ ...body, stops: [{ ...body.stops[0], selectedDrinkPriceEvidence: { ...evidence, pence: 850 } }] });
    expect(changed.status).toBe(409);
  });
  it("does not turn a listed display hint into server-verified community evidence", async () => {
    const submittedAt = Date.now();
    const reportedAt = new Date(submittedAt).toISOString();
    categoryIndexMock.mockResolvedValue({
      prices: [{ venueId: "venue-a", drinkCategory: "wine", priceGbp: 7.5,
        submittedAt, source: "community", corroborations: 2 }],
      degraded: false, truncated: false,
    });
    const listed = { category: "wine", pence: 750, serving: "125ml", source: "listed",
      sourceUrl: "https://pub.example/menu", observedAt: reportedAt, reportedAt };
    expect((await create("wine", listed)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    const community = { category: "wine", pence: 750, serving: null, source: "community", reportedAt };
    expect((await create("wine", community)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toEqual(community);
  });

});


describe("Plan listed-price authority and persistence", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");
  const observedAt = "2026-09-29T12:00:00.000Z";
  const a = { category: "wine", pence: 525, serving: "125ml", source: "listed",
    sourceUrl: "https://pub.example/a/menu", observedAt };
  const b = { ...a, pence: 610, serving: "175ml", sourceUrl: "https://pub.example/b/menu" };
  let restoreClock: () => void;
  beforeEach(() => {
    __resetMemoryPlans();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    restoreClock = () => { clock.mockRestore(); };
    categoryIndexMock.mockReset();
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: false, truncated: false });
    listedBundleFixture.status = "ready";
    listedBundleFixture.rows = [a, b].map((quote, index) => ({
      venueId: index === 0 ? "venue-a" : "venue-b", name: "Fixture pub", category: "wine",
      priceGbp: quote.pence / 100, drinkLabel: index === 0 ? "Rioja" : "Chenin",
      servingSize: quote.serving, sourceUrl: quote.sourceUrl, observedAt,
      lane: "site-harvest", standing: "listed", publisher: "Fixture publisher", basis: null, sampleSize: null,
    }));
  });
  afterEach(() => { restoreClock(); __resetMemoryPlans(); listedBundleFixture.rows = null; });

  it("re-reads listed wine at create, reloads it, and withholds it from anonymous preview", async () => {
    const { body, reloaded } = await create("wine", { ...a, contributor: "private-canary" });
    expect(body.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(a);
    expect(reloaded.stops[0]?.selectedDrinkPriceEvidence).toEqual(a);
    expect(JSON.stringify(buildPlanPrivacyPreview(reloaded))).not.toContain(a.sourceUrl);
  });

  it("verifies listed wine on route replacement and preserves member reload while redacting anonymous HTTP reads", async () => {
    const { body } = await create("wine", null);
    const response = await PATCH(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
      method: "PATCH", headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRouteRevision: 1, stops: [
        { venueId: "venue-a" }, { venueId: "venue-b", selectedDrinkPriceEvidence: b }, { venueId: "venue-c" },
      ] }),
    }), { params: Promise.resolve({ id: body.plan.plan.id }) });
    const updated = await response.json();
    expect(response.status, JSON.stringify(updated)).toBe(200);
    expect(updated.stops[1]?.selectedDrinkPriceEvidence).toEqual(b);
    const saved = (await memoryPlanStore.get(body.plan.plan.id))!;
    expect(saved.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    expect(saved.stops[1]?.selectedDrinkPriceEvidence).toEqual(b);
    const memberResponse = await GET(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
      headers: { authorization: `Bearer ${body.memberToken}` },
    }), { params: Promise.resolve({ id: body.plan.plan.id }) });
    expect(memberResponse.status).toBe(200);
    expect((await memberResponse.json()).stops[1]?.selectedDrinkPriceEvidence).toEqual(b);
    const anonymousResponse = await GET(new Request(`http://localhost/api/plans/${body.plan.plan.id}`),
      { params: Promise.resolve({ id: body.plan.plan.id }) });
    expect(anonymousResponse.status).toBe(200);
    const preview = await anonymousResponse.json();
    expect(preview).toMatchObject({ visibility: "preview", stopCount: 3 });
    for (const canary of [a.sourceUrl, b.sourceUrl, "selectedDrinkPriceEvidence", "private-canary", "venue-b"]) {
      expect(JSON.stringify(preview)).not.toContain(canary);
    }
  });

  it("replays verified listed evidence after a lost response but rejects a changed serving on the same operation key", async () => {
    const value = { creatorName: "Host", startTime: "2026-09-30T19:00:00.000Z",
      context: { ...inferNightContext("wine").context, nightArea: "piccadilly-soho", drinkCategory: "wine" },
      stops: [{ venueId: "venue-a", selectedDrinkPriceEvidence: a }] };
    const submit = (body = value) => POST(new Request("http://localhost/api/plans", {
      method: "POST", headers: { "idempotency-key": "listed-plan-retry", "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    const first = await submit();
    const original = await first.json();
    expect(first.status).toBe(201);
    expect(original.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(a);
    listedBundleFixture.status = "unavailable";
    listedBundleFixture.rows = [];
    const replay = await submit();
    const replayed = await replay.json();
    expect(replay.status).toBe(201);
    expect(replayed.created).toBe(false);
    expect(replayed.plan.plan.id).toBe(original.plan.plan.id);
    expect(replayed.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(a);
    const changed = await submit({ ...value, stops: [{ venueId: "venue-a", selectedDrinkPriceEvidence: { ...a, serving: "250ml" } }] });
    expect(changed.status).toBe(409);
  });
});
