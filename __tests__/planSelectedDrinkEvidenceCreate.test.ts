import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
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
  loadConciergeVenues: async () => [{ id: "venue-a", name: "Venue A" }],
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return { ...actual, readCommunityPriceCategoryIndex: categoryIndexMock };
});

import { POST } from "@/app/api/plans/route";
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
  beforeEach(() => { __resetMemoryPlans(); categoryIndexMock.mockReset(); });
  afterEach(() => { __resetMemoryPlans(); });

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
});
