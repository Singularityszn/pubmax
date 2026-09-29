import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { categoryIndexMock, bundleRowsMock } = vi.hoisted(() => ({ categoryIndexMock: vi.fn(), bundleRowsMock: vi.fn() }));
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
    { id: "venue-11bllvc", name: "Punch & Judy" },
  ],
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return { ...actual, readCommunityPriceCategoryIndex: categoryIndexMock };
});
vi.mock("@/lib/ukPriceBundle.server", () => ({ ukPriceBundleRowsFor: bundleRowsMock }));

import { POST } from "@/app/api/plans/route";
import { POST as propose } from "@/app/api/plans/[id]/proposals/route";
import { POST as decide } from "@/app/api/plans/[id]/proposals/[proposalId]/decision/route";
import { PATCH } from "@/app/api/plans/[id]/route";
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
  beforeEach(() => {
    __resetMemoryPlans();
    categoryIndexMock.mockReset();
    bundleRowsMock.mockReset().mockResolvedValue({ status: "empty", rows: [] });
  });
  afterEach(() => { __resetMemoryPlans(); });

  it.each(["wine", "cocktail"] as const)("rechecks a committed %s backup listing and keeps backup order", async (category) => {
    const committed = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")) as Array<{
      venueId: string; category: string; standing: string; priceGbp: number; sourceUrl: string; observedAt: string;
    }>;
    const row = committed.find((candidate) => candidate.venueId === "venue-11bllvc"
      && candidate.category === category && candidate.standing === "listed");
    expect(row).toBeDefined();
    const evidence = { category, pence: Math.round(row!.priceGbp * 100), serving: null, source: "listed" as const,
      sourceUrl: row!.sourceUrl, observedAt: row!.observedAt };
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: true, truncated: false });
    bundleRowsMock.mockImplementation(async (venueId: string) => ({
      status: "ready", rows: venueId === row!.venueId ? [row] : [],
    }));
    const submit = async (backupPrice: typeof evidence) => {
      const response = await POST(new Request("http://localhost/api/plans", {
        method: "POST",
        headers: { "idempotency-key": `listed-backup-${++sequence}`, "content-type": "application/json" },
        body: JSON.stringify({ creatorName: "Host", startTime: "2026-09-30T19:00:00.000Z",
          context: { ...inferNightContext(category).context, nightArea: "piccadilly-soho", drinkCategory: category },
          stops: [{ venueId: "venue-a", alternatives: [
            { venueId: row!.venueId, selectedDrinkPriceEvidence: backupPrice }, { venueId: "venue-b" },
          ] }],
        }),
      }));
      expect(response.status).toBe(201);
      return (await response.json() as { plan: { stops: Array<{ alternatives?: unknown[] }> } }).plan.stops[0].alternatives;
    };
    expect(await submit(evidence)).toEqual([
      { venueId: row!.venueId, venueName: "Punch & Judy", selectedDrinkPriceEvidence: evidence },
      { venueId: "venue-b", venueName: "Venue B" },
    ]);
    expect(await submit({ ...evidence, pence: 1 })).toEqual([
      { venueId: row!.venueId, venueName: "Punch & Judy" },
      { venueId: "venue-b", venueName: "Venue B" },
    ]);
  });

  it("preserves and revalidates backup evidence through replacement and context edits", async () => {
    const submittedAt = Date.now();
    const evidence = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: new Date(submittedAt).toISOString() };
    categoryIndexMock.mockResolvedValue({ prices: [{ venueId: "venue-11bllvc", drinkCategory: "wine", priceGbp: 5.5, submittedAt, source: "community", corroborations: 2 }], degraded: false, truncated: false });
    const { body } = await create("wine", null);
    const stops = [{ venueId: "venue-a", alternatives: [{ venueId: "venue-11bllvc", selectedDrinkPriceEvidence: evidence }] }, { venueId: "venue-b" }, { venueId: "venue-c" }];
    const patch = (payload: unknown) => PATCH(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
      method: "PATCH", headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json" }, body: JSON.stringify(payload),
    }), { params: Promise.resolve({ id: body.plan.plan.id }) });
    expect((await patch({ expectedRouteRevision: 1, stops })).status).toBe(200);
    expect((await memoryPlanStore.get(body.plan.plan.id))?.stops[0]?.alternatives).toEqual([{ venueId: "venue-11bllvc", venueName: "Punch & Judy", selectedDrinkPriceEvidence: evidence }]);
    expect((await patch({ context: { ...inferNightContext("cocktails").context, nightArea: "piccadilly-soho", drinkCategory: "cocktail" } })).status).toBe(200);
    expect((await memoryPlanStore.get(body.plan.plan.id))?.stops[0]?.alternatives).toEqual([{ venueId: "venue-11bllvc", venueName: "Punch & Judy" }]);
    expect((await patch({ expectedRouteRevision: 2, context: { ...inferNightContext("wine").context, nightArea: "piccadilly-soho", drinkCategory: "wine" }, stops: [{ ...stops[0], alternatives: [{ venueId: "venue-11bllvc", selectedDrinkPriceEvidence: { ...evidence, pence: 1 } }] }, ...stops.slice(1)] })).status).toBe(200);
    expect((await memoryPlanStore.get(body.plan.plan.id))?.stops[0]?.alternatives?.[0].selectedDrinkPriceEvidence).toBeUndefined();
  });

  it.each([false, true])("keeps revalidated proposal backups and invalidates them under current context (changed=%s)", async (changed) => {
    const submittedAt = Date.now();
    const evidence = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: new Date(submittedAt).toISOString() };
    categoryIndexMock.mockResolvedValue({ prices: [{ venueId: "venue-11bllvc", drinkCategory: "wine", priceGbp: 5.5, submittedAt, source: "community", corroborations: 2 }], degraded: false, truncated: false });
    const { body } = await create("wine", null);
    const id = body.plan.plan.id;
    const request = (path: string, payload: unknown) => new Request(`http://localhost/api/plans/${id}/${path}`, {
      method: "POST", headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json", "idempotency-key": `proposal-backup-${++sequence}` }, body: JSON.stringify(payload),
    });
    const response = await propose(request("proposals", { expectedRouteRevision: 1, reason: "Keep backups", stops: [
      { venueId: "venue-a", alternatives: [{ venueId: "venue-11bllvc", venueName: "Forged name", selectedDrinkPriceEvidence: evidence }] },
      { venueId: "venue-b" }, { venueId: "venue-c" },
    ] }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(201);
    const { proposal } = await response.json();
    expect(proposal.stops[0].alternatives).toEqual([{ venueId: "venue-11bllvc", venueName: "Punch & Judy", selectedDrinkPriceEvidence: evidence }]);
    if (changed) await memoryPlanStore.update(id, body.memberToken, { context: { ...inferNightContext("wine").context, zeroProof: true } });
    const decision = await decide(request(`proposals/${proposal.id}/decision`, { decision: "accepted" }), { params: Promise.resolve({ id, proposalId: proposal.id }) });
    expect(decision.status).toBe(200);
    expect((await memoryPlanStore.get(id))?.stops[0]?.alternatives).toEqual([{ venueId: "venue-11bllvc", venueName: "Punch & Judy", ...(!changed ? { selectedDrinkPriceEvidence: evidence } : {}) }]);
  });

  it("re-resolves a listed hint from the approved bundle on create and replace despite a degraded community read", async () => {
    const row = {
      venueId: "venue-a", name: "Venue A", category: "wine", priceGbp: 5.25,
      lane: "site-harvest", standing: "listed", sourceUrl: "https://www.sydneyarmschelsea.com/menu/",
      publisher: "sydneyarmschelsea.com", observedAt: "2026-09-21T18:33:02.365Z",
      basis: null, sampleSize: null, drinkLabel: "red Rioja, Spain 125ml", drinkSubtype: "wine-red",
    };
    const evidence = {
      category: "wine", pence: 525, serving: null, source: "listed",
      sourceUrl: row.sourceUrl, observedAt: row.observedAt,
    };
    bundleRowsMock.mockImplementation(async () => ({ status: "ready", rows: [row] }));
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: true, truncated: false });

    const { body, reloaded } = await create("wine", { ...evidence, sourceUrl: "https://forged.example/menu" });
    expect(reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();

    const accepted = await create("wine", { ...evidence, privateContributor: "hidden" });
    expect(accepted.reloaded.stops[0]?.selectedDrinkPriceEvidence).toEqual(evidence);
    expect(accepted.body.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(evidence);
    expect(JSON.stringify(buildPlanPrivacyPreview(accepted.reloaded))).not.toContain(row.sourceUrl);
    for (const forged of [
      { ...evidence, pence: 100 },
      { ...evidence, serving: "125ml" },
      { ...evidence, observedAt: "2026-09-20T18:33:02.365Z" },
      { ...evidence, category: "cocktail" },
    ]) {
      expect((await create("wine", forged)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    }

    const response = await PATCH(new Request(`http://localhost/api/plans/${body.plan.plan.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${body.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRouteRevision: 1, stops: [
        { venueId: "venue-a", selectedDrinkPriceEvidence: evidence },
        { venueId: "venue-b" }, { venueId: "venue-c" },
      ] }),
    }), { params: Promise.resolve({ id: body.plan.plan.id }) });
    expect(response.status).toBe(200);
    expect((await memoryPlanStore.get(body.plan.plan.id))?.stops[0]?.selectedDrinkPriceEvidence).toEqual(evidence);

    bundleRowsMock.mockResolvedValue({ status: "unavailable", rows: [] });
    expect((await create("wine", evidence)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();

    const submittedAt = Date.now();
    categoryIndexMock.mockResolvedValue({
      prices: [{ venueId: "venue-a", drinkCategory: "wine", priceGbp: 7.5, submittedAt, source: "community", corroborations: 2 }],
      degraded: false, truncated: false,
    });
    bundleRowsMock.mockResolvedValue({ status: "ready", rows: [row] });
    expect((await create("wine", evidence)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();

    const measuredRow = {
      ...row, servingSize: "125ml", observedAt: "2026-09-29T10:40:17.846Z",
    };
    const measuredEvidence = {
      ...evidence, serving: "125ml", observedAt: measuredRow.observedAt,
    };
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: false, truncated: false });
    bundleRowsMock.mockResolvedValue({ status: "ready", rows: [measuredRow] });
    expect((await create("wine", measuredEvidence)).reloaded.stops[0]?.selectedDrinkPriceEvidence).toEqual(measuredEvidence);
  });

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
});
