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

import { composerCreatePayload } from "@/components/plan/PlanComposer";
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

  it("retains current listed evidence through member route replacement without Night Context", async () => {
    const observedAt = new Date(Date.now() - 60_000).toISOString();
    const a = {
      category: "wine",
      pence: 525,
      serving: "125ml",
      source: "listed",
      sourceUrl: "https://pub.example/manual/menu",
      observedAt,
    };
    const submittedHint = { ...a, contributor: "private-canary" };
    listedBundleFixture.rows = [{
      venueId: "venue-a",
      name: "Venue A",
      category: "wine",
      priceGbp: 5.25,
      drinkLabel: "Rioja",
      servingSize: "125ml",
      sourceUrl: a.sourceUrl,
      observedAt,
      lane: "site-harvest",
      standing: "listed",
      publisher: "Fixture publisher",
      basis: null,
      sampleSize: null,
    }];

    const createResponse = await POST(new Request("http://localhost/api/plans", {
      method: "POST",
      headers: { "idempotency-key": `manual-null-patch-${++sequence}`, "content-type": "application/json" },
      body: JSON.stringify({
        title: "Manual wine stop",
        creatorName: "Host",
        startTime: "2026-09-30T19:00:00.000Z",
        stops: [{ venueId: "venue-a", venueName: "Venue A", selectedDrinkPriceEvidence: submittedHint }],
      }),
    }));
    const created = await createResponse.json();
    expect(createResponse.status, JSON.stringify(created)).toBe(201);
    expect(created.plan.context).toBeNull();
    expect(created.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(a);

    const planId = created.plan.plan.id as string;
    const patchResponse = await PATCH(new Request(`http://localhost/api/plans/${planId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${created.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRouteRevision: 1, stops: [
        { venueId: "venue-a", venueName: "Venue A", selectedDrinkPriceEvidence: submittedHint },
        { venueId: "venue-b", venueName: "Venue B" },
        { venueId: "venue-c", venueName: "Venue C" },
      ] }),
    }), { params: Promise.resolve({ id: planId }) });
    const updated = await patchResponse.json();
    expect(patchResponse.status, JSON.stringify(updated)).toBe(200);
    expect(updated.context).toBeNull();
    expect(updated.stops[0]?.selectedDrinkPriceEvidence).toEqual(a);

    const stored = await memoryPlanStore.get(planId);
    expect(stored?.context).toBeNull();
    expect(stored?.stops[0]?.selectedDrinkPriceEvidence).toEqual(a);

    const memberReload = await GET(new Request(`http://localhost/api/plans/${planId}`, {
      headers: { authorization: `Bearer ${created.memberToken}` },
    }), { params: Promise.resolve({ id: planId }) });
    expect(memberReload.status).toBe(200);
    const memberPlan = await memberReload.json();
    expect(memberPlan.context).toBeNull();
    expect(memberPlan.stops[0]?.selectedDrinkPriceEvidence).toEqual(a);

    const anonymousRead = await GET(new Request(`http://localhost/api/plans/${planId}`), {
      params: Promise.resolve({ id: planId }),
    });
    expect(anonymousRead.status).toBe(200);
    const preview = await anonymousRead.json();
    expect(preview).toMatchObject({ visibility: "preview", stopCount: 3 });
    for (const privateValue of ["venue-a", "venue-b", "venue-c", a.sourceUrl, "selectedDrinkPriceEvidence", "private-canary"]) {
      expect(JSON.stringify(preview)).not.toContain(privateValue);
    }
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

  it("keeps the selected fifth listed serving on canonical venue PATCH and member reload", async () => {
    const servings = ["125ml", "150ml", "175ml", "200ml", "250ml"];
    const sourceUrl = "https://pub.example/venue-b/menu";
    listedBundleFixture.rows = servings.map((servingSize, index) => ({
      venueId: "venue-b",
      name: "Venue B",
      category: "wine",
      priceGbp: [5.25, 5.5, 5.75, 6, 6.5][index]!,
      drinkLabel: "Rioja",
      servingSize,
      sourceUrl,
      observedAt,
      lane: "site-harvest",
      standing: "listed",
      publisher: "Fixture publisher",
      basis: null,
      sampleSize: null,
    }));
    const selected = {
      category: "wine",
      pence: 650,
      serving: "250ml",
      source: "listed",
      sourceUrl,
      observedAt,
    };
    const { body } = await create("wine", null);
    const response = await PATCH(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRouteRevision: 1, stops: [
        { venueId: "venue-a" },
        { venueId: "venue-b", venueName: "Venue B", selectedDrinkPriceEvidence: selected },
        { venueId: "venue-c" },
      ] }),
    }), { params: Promise.resolve({ id: body.plan.plan.id }) });
    const updated = await response.json();
    expect(response.status, JSON.stringify(updated)).toBe(200);
    expect(updated.stops[1]?.selectedDrinkPriceEvidence).toEqual(selected);

    const reload = await GET(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
      headers: { authorization: `Bearer ${body.memberToken}` },
    }), { params: Promise.resolve({ id: body.plan.plan.id }) });
    expect(reload.status).toBe(200);
    expect((await reload.json()).stops[1]?.selectedDrinkPriceEvidence).toEqual(selected);
  });

  it("keeps listed evidence on a manual create payload without Night Context", () => {
    const matched = { ...inferNightContext("wine").context, drinkCategory: "wine" as const, zeroProof: false };
    const payloadFor = (
      context: Parameters<typeof composerCreatePayload>[0]["context"],
      selectedDrinkPriceEvidence: unknown,
    ) => composerCreatePayload({
      title: "Manual wine stop",
      creatorName: "Host",
      startTime: "2026-09-30T19:00:00.000Z",
      stops: [{ venueId: "venue-a", venueName: "Fixture pub", selectedDrinkPriceEvidence }],
      context,
    });

    const manual = payloadFor(null, a);
    expect(manual).not.toHaveProperty("context");
    expect(manual.stops).toEqual([{
      venueId: "venue-a", venueName: "Fixture pub", selectedDrinkPriceEvidence: a,
    }]);
    expect(payloadFor(null, {
      category: "wine", pence: 525, serving: null, source: "community", reportedAt: observedAt,
    }).stops).toEqual([{ venueId: "venue-a", venueName: "Fixture pub" }]);
    expect(payloadFor(matched, a).stops).toEqual([{
      venueId: "venue-a", venueName: "Fixture pub", selectedDrinkPriceEvidence: a,
    }]);
    expect(payloadFor({ ...matched, drinkCategory: "cocktail" }, a).stops).toEqual([
      { venueId: "venue-a", venueName: "Fixture pub" },
    ]);
    expect(payloadFor({ ...matched, zeroProof: true }, a).stops).toEqual([
      { venueId: "venue-a", venueName: "Fixture pub" },
    ]);
  });

  it("verifies and reloads a listed quote on manual create when Night Context is absent", async () => {
    const requestBody = {
      title: "Manual wine stop",
      creatorName: "Host",
      startTime: "2026-09-30T19:00:00.000Z",
      stops: [{ venueId: "venue-a", venueName: "Fixture pub", selectedDrinkPriceEvidence: a }],
    };
    const response = await POST(new Request("http://localhost/api/plans", {
      method: "POST",
      headers: { "idempotency-key": `manual-listed-${++sequence}`, "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    }));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(a);
    const reloaded = await memoryPlanStore.get(body.plan.plan.id);
    expect(reloaded?.stops[0]?.selectedDrinkPriceEvidence).toEqual(a);
  });

  it("verifies a selected fifth wine serving at create without raising the four-quote projection cap", async () => {
    const servings = ["125ml", "150ml", "175ml", "200ml", "250ml"];
    const selectedSourceUrl = "https://pub.example/selected/menu";
    listedBundleFixture.rows = servings.map((servingSize, index) => ({
      venueId: "venue-a",
      name: "Fixture pub",
      category: "wine",
      priceGbp: [5.25, 5.5, 5.75, 6, 6.5][index]!,
      drinkLabel: "Rioja",
      servingSize,
      sourceUrl: selectedSourceUrl,
      observedAt,
      lane: "site-harvest",
      standing: "listed",
      publisher: "Fixture publisher",
      basis: null,
      sampleSize: null,
    }));
    const fifthServing = {
      category: "wine",
      pence: 650,
      serving: "250ml",
      source: "listed",
      sourceUrl: selectedSourceUrl,
      observedAt,
    };

    const { body, reloaded } = await create("wine", fifthServing);

    expect(body.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(fifthServing);
    expect(reloaded.stops[0]?.selectedDrinkPriceEvidence).toEqual(fifthServing);
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


describe("Cider actual own quote save and context compatibility", () => {
  const now = Date.parse("2026-10-03T12:00:00.000Z");
  const evidence = { category: "beer" as const, pence: 365, serving: null, source: "listed" as const,
    sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/", observedAt: "2026-09-21T18:27:31.674Z",
    drinkLabel: "Aspall 4.5%", drinkSubtype: "beer-cider" };
  const context = { ...inferNightContext("quiet in Clapham for 2", new Date(now)).context,
    drinkCategory: "beer" as const, drinkSubtype: "beer-cider", drinkServing: null as string | null, zeroProof: false };
  let restoreClock: () => void;
  let restoreVenueLoader = () => {};

  beforeEach(async () => {
    __resetMemoryPlans();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    restoreClock = () => clock.mockRestore();
    categoryIndexMock.mockReset();
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: false, truncated: false });
    // Null uses the real committed bundle parser/rows, not an invented price fixture.
    listedBundleFixture.rows = null;
    listedBundleFixture.status = "ready";
    const venueModule = await import("@/lib/concierge/venues.server");
    const existingFixtureVenues = await venueModule.loadConciergeVenues("london");
    const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
    const plough = (await actual.loadConciergeVenues("london")).find((venue) => venue.id === "venue-13xdb1p");
    expect(plough).toBeDefined();
    // Extend only this describe's canonical-id seam with the real committed venue.
    const loader = vi.spyOn(venueModule, "loadConciergeVenues").mockResolvedValue([...existingFixtureVenues, plough!]);
    restoreVenueLoader = () => loader.mockRestore();
  });
  afterEach(() => { restoreVenueLoader(); restoreClock(); __resetMemoryPlans(); listedBundleFixture.rows = null; });

  async function save(hint: unknown = evidence, selectedContext: typeof context = context, venueId = "venue-13xdb1p", asBackup = false) {
    const response = await POST(new Request("http://localhost/api/plans", {
      method: "POST", headers: { "idempotency-key": `cider-own-${++sequence}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "Cider choice", creatorName: "Host", startTime: "2026-10-03T19:00:00.000Z",
        context: selectedContext, stops: [asBackup
          ? { venueId: "venue-a", venueName: "Untrusted submitted name", alternatives: [{ venueId, venueName: "Untrusted backup name", selectedDrinkPriceEvidence: hint }] }
          : { venueId, venueName: "Untrusted submitted name", selectedDrinkPriceEvidence: hint }] }),
    }));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    return body;
  }

  it("corroborates actual Plough named-eight tuple at save and member reload, preserving unknown serving", async () => {
    const created = await save();
    expect(created.plan.stops[0]).toMatchObject({ venueId: "venue-13xdb1p", venueName: "The Plough", selectedDrinkPriceEvidence: evidence });
    expect(created.plan.context).toMatchObject({ drinkCategory: "beer", drinkSubtype: "beer-cider", drinkServing: null });
    const reloaded = await GET(new Request(`http://localhost/api/plans/${created.plan.plan.id}`, {
      headers: { authorization: `Bearer ${created.memberToken}` },
    }), { params: Promise.resolve({ id: created.plan.plan.id }) });
    expect(reloaded.status).toBe(200);
    const member = await reloaded.json();
    expect(member.stops[0]?.selectedDrinkPriceEvidence).toEqual(evidence);
    expect(member.context).toMatchObject({ drinkSubtype: "beer-cider", drinkServing: null });
    expect(JSON.stringify(buildPlanPrivacyPreview(member))).not.toContain(evidence.sourceUrl);
    expect(categoryIndexMock).not.toHaveBeenCalled();
  });

  it.each([
    ["forged amount", { ...evidence, pence: 100 }, "venue-13xdb1p"],
    ["forged source", { ...evidence, sourceUrl: "https://other.example/menu" }, "venue-13xdb1p"],
    ["forged observation", { ...evidence, observedAt: "2026-09-22T18:27:31.674Z" }, "venue-13xdb1p"],
    ["other printed cider", { ...evidence, drinkLabel: "Thatchers cider" }, "venue-13xdb1p"],
    ["same tuple on sibling pub", evidence, "venue-b"],
  ] as const)("never saves %s as this venue's own quote", async (_label, hint, venueId) => {
    const created = await save(hint, context, venueId);
    expect(created.plan.stops[0]).not.toHaveProperty("selectedDrinkPriceEvidence");
    expect(created.plan.context).toHaveProperty("drinkSubtype", "beer-cider");
  });

  it("keeps requested Cider after current quote becomes unavailable without saving a stale hint", async () => {
    listedBundleFixture.rows = [];
    listedBundleFixture.status = "unavailable";
    const created = await save();
    expect(created.plan.stops[0]).not.toHaveProperty("selectedDrinkPriceEvidence");
    expect(created.plan.context).toHaveProperty("drinkSubtype", "beer-cider");
  });

  it("does not reinterpret the unknown source serving as a requested pint", async () => {
    const created = await save(evidence, { ...context, drinkServing: "pint" });
    expect(created.plan.stops[0]).not.toHaveProperty("selectedDrinkPriceEvidence");
    expect(created.plan.context).toMatchObject({ drinkSubtype: "beer-cider", drinkServing: "pint" });
  });

  it.each([
    { drinkCategory: "beer", drinkSubtype: null, drinkServing: null, zeroProof: false },
    { drinkCategory: "beer", drinkSubtype: "beer-lager", drinkServing: null, zeroProof: false },
    { drinkCategory: "beer", drinkSubtype: "beer-cider", drinkServing: "pint", zeroProof: false },
    { drinkCategory: null, drinkSubtype: null, drinkServing: null, zeroProof: true },
  ])("clears saved primary quote when current choice changes to %j", async (change) => {
    const created = await save();
    expect(created.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(evidence);
    const response = await PATCH(new Request(`http://localhost/api/plans/${created.plan.plan.id}`, {
      method: "PATCH", headers: { authorization: `Bearer ${created.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ context: { ...created.plan.context, ...change } }),
    }), { params: Promise.resolve({ id: created.plan.plan.id }) });
    expect(response.status).toBe(200);
    const saved = await memoryPlanStore.get(created.plan.plan.id);
    expect(saved?.stops[0]).not.toHaveProperty("selectedDrinkPriceEvidence");
    expect(saved?.context).toMatchObject({ zeroProof: change.zeroProof });
  });


  it("clears an actually saved own Cider backup after a same-category generic Beer edit", async () => {
    const created = await save(evidence, context, "venue-13xdb1p", true);
    expect(created.plan.stops[0]?.alternatives?.[0]).toMatchObject({ venueId: "venue-13xdb1p", selectedDrinkPriceEvidence: evidence });
    const response = await PATCH(new Request(`http://localhost/api/plans/${created.plan.plan.id}`, {
      method: "PATCH", headers: { authorization: `Bearer ${created.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ context: { ...created.plan.context, drinkCategory: "beer", drinkSubtype: null, drinkServing: null, zeroProof: false } }),
    }), { params: Promise.resolve({ id: created.plan.plan.id }) });
    expect(response.status).toBe(200);
    const saved = await memoryPlanStore.get(created.plan.plan.id);
    expect(saved?.stops[0]?.alternatives?.[0]).toMatchObject({ venueId: "venue-13xdb1p" });
    expect(saved?.stops[0]?.alternatives?.[0]).not.toHaveProperty("selectedDrinkPriceEvidence");
  });


  it("keeps Cider request when a controlled expired copy of its own published row cannot corroborate a stale hint", async () => {
    const expiredAt = "2025-09-21T18:27:31.674Z";
    // Controlled freshness negative derived from the exact captured row; not a new published observation.
    listedBundleFixture.rows = [{ venueId: "venue-13xdb1p", name: "The Plough", category: "beer",
      priceGbp: 3.65, drinkLabel: "Aspall 4.5%", sourceUrl: evidence.sourceUrl, observedAt: expiredAt,
      lane: "site-harvest", standing: "listed", publisher: "theploughstjohnshill.co.uk", basis: null, sampleSize: null }];
    const created = await save({ ...evidence, observedAt: expiredAt });
    expect(created.plan.stops[0]).not.toHaveProperty("selectedDrinkPriceEvidence");
    expect(created.plan.context).toHaveProperty("drinkSubtype", "beer-cider");
  });
});
