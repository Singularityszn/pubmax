import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Server pack fixture copied exactly from committed
// public/data/uk_base/packs/a917f46cc28c0e9e/51.25_-0.25.json.
// Only the existing UK identity reader is doubled; this pub is NEVER added to
// the curated venue/candidate catalogue and has no invented price or amenity.
const basePlanPack = vi.hoisted(() => ({
  result: { status: "missing" } as import("@/lib/ukBaseIndex").UkBasePubLookupResult,
  pub: { id: "venue-uk-n8308248176", name: "The Sydney Arms",
    address: "70, Sydney Street, London, SW3 6NJ", lat: 51.48876, lng: -0.16951,
    curatedVenueId: "", kind: "pub" as const },
}));
vi.mock("@/lib/ukBaseIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukBaseIndex")>();
  return { ...actual, lookupUkBasePub: async (id: string) =>
    id === basePlanPack.pub.id ? basePlanPack.result : { status: "missing" as const } };
});


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
    ukPriceBundleCategoryIndex: async (category: import("@/lib/drinks").DrinkCategory, now: number, serving?: string | null) => {
      if (listedBundleFixture.rows === null) return actual.ukPriceBundleCategoryIndex(category, now, serving);
      const prices = [...new Set(listedBundleFixture.rows.map((row) => row.venueId))].flatMap((venueId) => {
        return listedCategoryPrices(listedBundleFixture.rows!.filter((row) => row.venueId === venueId), now, { serving })
          .filter((value) => value.category === category)
          .map((quote) => ({ venueId, ...quote }));
      });
      return { prices, truncated: false, degraded: listedBundleFixture.status === "unavailable" };
    },
  };
});


const { isLimitedMock, loadConciergeVenuesMock, resolvePlanningAnchorMock, categoryIndexMock } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async () => false),
  loadConciergeVenuesMock: vi.fn(),
  resolvePlanningAnchorMock: vi.fn(),
  categoryIndexMock: vi.fn(),
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/public/data/weather/latest.json", () => ({
  default: { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", observations: [] },
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});
vi.mock("@/lib/concierge/venues.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/venues.server")>();
  loadConciergeVenuesMock.mockImplementation(actual.loadConciergeVenues);
  return { ...actual, loadConciergeVenues: loadConciergeVenuesMock };
});
vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLegRoute: vi.fn(async () => null),
  orsApiKey: vi.fn(() => null),
}));
vi.mock("@/lib/walkRouteStore", () => ({
  walkRouteStore: () => ({ getLeg: vi.fn(async () => null), putLeg: vi.fn(async () => undefined) }),
}));
vi.mock("@/lib/communityPriceStore", () => ({
  readCommunityPriceCategoryIndex: categoryIndexMock,
}));
vi.mock("@/lib/planningAnchor.server", () => ({ resolvePlanningAnchor: resolvePlanningAnchorMock }));

import { POST } from "@/app/api/plans/generate/route";
import { preparePlanGeneration } from "@/lib/planGeneration.server";
import { verifyAnchoredPlanGroundingProofV2, verifyPlanGroundingProof } from "@/lib/planGrounding.server";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { PlanIntakeHandoff } from "@/lib/planIntake";
import type { SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

function claphamVenue(id: string, index: number, options: Partial<ConciergeVenue> = {}): ConciergeVenue {
  return {
    id,
    name: `Venue ${id}`,
    area: "Lambeth",
    lat: 51.462 + index * 0.001,
    lng: -0.138 + index * 0.001,
    cheapestPrice: 5,
    amenities: { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false },
    nearWater: false,
    hasStory: false,
    canonical: true,
    ...options,
  };
}

function intake(overrides: Partial<PlanIntakeHandoff> = {}): PlanIntakeHandoff {
  return {
    version: 1,
    area: { kind: "night-patch", id: "clapham" },
    timeWindow: null,
    groupSize: 4,
    budget: { tier: "standard", limitPence: null },
    accessibilityNeeds: [],
    skipped: ["time-window"],
    ...overrides,
  };
}

function resolved(venueId: string) {
  return {
    status: "resolved" as const,
    display: {
      venueId, venueName: "Anchor", areaName: "Clapham", startLabel: null,
      priceEvidence: null, routeWindowOk: true, budgetCompatible: true, accessibilityCompatible: true,
    },
    canonical: {
      cityId: "london" as const, venueId, nightAreaSlug: "clapham-high-street", acceptedArea: { kind: "night-patch" as const, id: "clapham" as const },
      coordinates: { lat: 51.462, lng: -0.138 }, startsAt: null, priceObservedAt: null, priceFreshnessKind: "unknown" as const,
    },
  };
}

function generate(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request("http://localhost/api/plans/generate", {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

const ANCHOR = { venueId: "anchor-venue", source: "near", acceptedArea: { kind: "night-patch", id: "clapham" }, startsAt: null };
const SERVING_NOW = Date.parse("2026-09-30T12:00:00.000Z");
const SERVING_OBSERVED = "2026-09-29T12:00:00.000Z";
const SELECTED_LISTED = {
  category: "wine", pence: 800, serving: "125ml", source: "listed",
  sourceUrl: "https://pub.example/anchor-venue/menu", observedAt: SERVING_OBSERVED,
} satisfies SelectedDrinkPriceEvidence;

function listedQuote(
  venueId: string, priceGbp: number, servingSize: string | undefined,
  changes: Partial<UkPriceBundleRow> = {},
): UkPriceBundleRow {
  return {
    venueId, name: `Venue ${venueId}`, category: "wine", priceGbp,
    drinkLabel: "Chenin", ...(servingSize ? { servingSize } : {}),
    lane: "site-harvest", standing: "listed", sourceUrl: `https://pub.example/${venueId}/menu`,
    observedAt: SERVING_OBSERVED, publisher: "Fixture publisher", basis: null, sampleSize: null,
    ...changes,
  };
}

async function withServingFixtures(
  venues: ConciergeVenue[], rows: UkPriceBundleRow[], run: () => Promise<void>,
): Promise<void> {
  const clock = vi.spyOn(Date, "now").mockReturnValue(SERVING_NOW);
  const originalLoad = loadConciergeVenuesMock.getMockImplementation();
  loadConciergeVenuesMock.mockResolvedValue(venues);
  resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
  listedBundleFixture.status = "ready";
  listedBundleFixture.rows = rows;
  try {
    await run();
  } finally {
    clock.mockRestore();
    listedBundleFixture.rows = null;
    loadConciergeVenuesMock.mockReset();
    if (originalLoad) loadConciergeVenuesMock.mockImplementation(originalLoad);
  }
}

describe("POST /api/plans/generate — anchored", () => {
  beforeEach(() => {
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValue(false);
    loadConciergeVenuesMock.mockClear();
    resolvePlanningAnchorMock.mockReset();
    categoryIndexMock.mockReset();
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: false, truncated: false });
    process.env.PLAN_IDEMPOTENCY_SECRET = "a".repeat(48);
  });
  afterEach(() => {
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
  });

  it("keeps an eligible category offer discoverable beyond closer unpriced backups without ranking its unknown measure", async () => {
    // Business-contract fixtures, not claims about a real menu: all pubs fit
    // the existing Clapham radius, but the sole current gin offer is farther
    // than three route stops and two nearer alternatives. No accepted anchor
    // or serving is invented by this unanchored phone generation request.
    const nearIds = ["near-0", "near-1", "near-2", "near-3", "near-4"];
    const venues = [
      ...nearIds.map((id, index) => claphamVenue(id, index)),
      claphamVenue("category-offer", 10),
    ];
    const offer = listedQuote("category-offer", 7, undefined, {
      category: "gin", drinkLabel: "Fixture gin", publisher: "Fixture menu publisher",
    });
    const rows = [
      offer,
      listedQuote("near-0", 0.1, "125ml", { category: "wine" }),
      listedQuote("near-1", 0.2, undefined, {
        category: "gin", drinkLabel: "Expired fixture gin", observedAt: "2025-09-29T12:00:00.000Z",
      }),
    ];
    await withServingFixtures(venues, rows, async () => {
      const requestBody = { query: "cheap gin in Clapham for 2", context: { daypart: "evening" } };
      const prepare = () => preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(requestBody),
      }));
      const first = await prepare();
      expect("prepared" in first).toBe(true);
      if (!("prepared" in first)) return;
      expect(first.prepared.anchor).toBeNull();
      expect(first.prepared.candidates.find(({ venue }) => venue.id === "category-offer")?.selectedDrinkPrice)
        .toMatchObject({ category: "gin", source: "listed", servingSize: null, priceGbp: 7 });
      for (const id of ["near-0", "near-1"]) {
        expect(first.prepared.candidates.find(({ venue }) => venue.id === id)?.selectedDrinkPrice).toBeNull();
      }
      const originalScores = first.prepared.candidates.map(({ venue, score }) => ({ id: venue.id, score }));
      // Quote availability may retain a choice. A lower raw amount with no
      // recorded serving must not become a comparison or change its rank.
      offer.priceGbp = 0.1;
      try {
        const changedAmount = await prepare();
        expect("prepared" in changedAmount).toBe(true);
        if (!("prepared" in changedAmount)) return;
        expect(changedAmount.prepared.candidates.find(({ venue }) => venue.id === "category-offer")?.selectedDrinkPrice)
          .toMatchObject({ category: "gin", source: "listed", servingSize: null, priceGbp: 0.1 });
        expect(changedAmount.prepared.candidates.map(({ venue, score }) => ({ id: venue.id, score })))
          .toEqual(originalScores);
      } finally {
        offer.priceGbp = 7;
      }
      type QuotedStop = { venueId: string; selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence | null; alternatives?: QuotedStop[] };
      const response = await generate(requestBody);
      const body = await response.json() as {
        grounded: boolean; operationKey: string; groundingProof: string; stops: QuotedStop[];
        budgetSummary: { estimatedPerPersonPence: number | null; estimatedCrewPence: number | null; basis: string };
      };
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.grounded).toBe(true);
      expect(body.stops).toHaveLength(3);
      expect(body.budgetSummary).toMatchObject({ estimatedPerPersonPence: null,
        estimatedCrewPence: null, basis: "selected-drink-price-unavailable" });
      for (const stop of body.stops) expect(stop.alternatives?.length ?? 0).toBeLessThanOrEqual(2);
      const choices = body.stops.flatMap((stop) => [stop, ...(stop.alternatives ?? [])]);
      const routeIds = body.stops.map((stop) => stop.venueId);
      expect(verifyPlanGroundingProof(body.groundingProof, routeIds, body.operationKey)).toBe(true);
      for (const [index, stop] of body.stops.entries()) {
        for (const alternative of stop.alternatives ?? []) {
          const swapped = routeIds.map((id, position) => position === index ? alternative.venueId : id);
          expect(verifyPlanGroundingProof(body.groundingProof, swapped, body.operationKey)).toBe(true);
        }
      }
      expect(resolvePlanningAnchorMock).not.toHaveBeenCalled();
      // Coverage, not Cheapest: at least one route/backup choice exposes the
      // current category evidence, without requiring a price-ordered primary.
      expect(choices.find((stop) => stop.venueId === "category-offer"),
        "An eligible current category offer must remain discoverable when nearer pubs have no offer")
        .toMatchObject({ selectedDrinkPriceEvidence: { category: "gin", pence: 700, serving: null,
          source: "listed", sourceUrl: offer.sourceUrl, observedAt: SERVING_OBSERVED } });
      for (const choice of choices) {
        if (choice.venueId === "near-0" || choice.venueId === "near-1") {
          expect(choice.selectedDrinkPriceEvidence ?? null).toBeNull();
        }
      }
      // A requested-drink route must include an eligible offer, not leave it
      // exclusively in backups. Unknown serving still forbids amount ranking.
      expect(body.stops.some((stop) => stop.selectedDrinkPriceEvidence?.category === "gin"),
        "The primary route must include an eligible requested-category offer")
        .toBe(true);
    });
  });

  it.each([
    ["125ml", "250ml", "125 ml glass"],
    ["250ml", "125ml", "250 ml glass"],
  ] as const)("ranks and delivers accepted %s across distinct brands without comparing another measure", async (serving, differentServing, equivalentServing) => {
    const selected = { ...SELECTED_LISTED, serving };
    const ids = ["anchor-venue", "same-measure-cheap", "same-measure-next", "different-measure", "unknown-measure", "stale-measure", "different-category"];
    const venues = ids.map((id) => claphamVenue(id, 0));
    const rows = [
      listedQuote("anchor-venue", 1, differentServing),
      listedQuote("anchor-venue", 8, serving),
      listedQuote("same-measure-cheap", 6, equivalentServing, { drinkLabel: "Pinot Noir" }),
      listedQuote("same-measure-next", 7, serving, { drinkLabel: "Chardonnay" }),
      listedQuote("different-measure", 1, differentServing, { drinkLabel: "Rioja" }),
      listedQuote("unknown-measure", 0.5, undefined, { drinkLabel: "House wine" }),
      listedQuote("stale-measure", 0.25, serving, { observedAt: "2025-09-29T12:00:00.000Z" }),
      listedQuote("different-category", 0.1, serving, { category: "gin", drinkLabel: "Sacred Gin" }),
    ];
    await withServingFixtures(venues, rows, async () => {
      const requestBody = {
        query: "cheap wine in Clapham for 2 after work",
        anchor: { ...ANCHOR, selectedDrinkPriceEvidence: selected },
      };
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(requestBody),
      }));
      expect("prepared" in prepared).toBe(true);
      if (!("prepared" in prepared)) return;
      const order = prepared.prepared.candidates.map((candidate) => candidate.venue.id);
      expect(order).toEqual(expect.arrayContaining(["anchor-venue", "same-measure-cheap", "same-measure-next"]));
      for (const comparable of ["same-measure-cheap", "same-measure-next"]) {
        for (const neutral of ["different-measure", "unknown-measure", "stale-measure", "different-category"]) {
          const neutralIndex = order.indexOf(neutral);
          if (neutralIndex !== -1) expect(order.indexOf(comparable)).toBeLessThan(neutralIndex);
        }
      }
      expect(order.indexOf("same-measure-cheap")).toBeLessThan(order.indexOf("same-measure-next"));

      const response = await generate(requestBody);
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ grounded: true, outcome: "route", anchored: true });
      expect(body.stops).toHaveLength(3);
      expect(body.stops[0]).toMatchObject({ venueId: "anchor-venue", selectedDrinkPriceEvidence: selected });
      expect(body.stops.map((stop: { venueId: string }) => stop.venueId))
        .toEqual(expect.arrayContaining(["anchor-venue", "same-measure-cheap", "same-measure-next"]));
      for (const stop of body.stops) {
        expect(stop.estimatedPintPricePence).toBeNull();
        expect(stop.priceEvidence).toBeNull();
        expect(stop.selectedDrinkPriceEvidence).toMatchObject({ category: "wine", source: "listed" });
      }
      expect(body.stops.find((stop: { venueId: string }) => stop.venueId === "same-measure-cheap"))
        .toMatchObject({ selectedDrinkPriceEvidence: { pence: 600, serving: equivalentServing } });
      expect(verifyAnchoredPlanGroundingProofV2(body.groundingProof,
        body.stops.map((stop: { venueId: string }) => stop.venueId), body.operationKey))
        .toMatchObject({ ok: true, anchored: true, outcome: "route" });
    });
  });

  it("grounds and delivers a selected fifth 250ml wine quote through the actual generate POST", async () => {
    const selected = { ...SELECTED_LISTED, serving: "250ml" };
    const venues = ["anchor-venue", "same-measure-cheap", "same-measure-next"]
      .map((id) => claphamVenue(id, 0));
    // Five current source-stated groups. The selected quote is beyond the
    // default four/category projection; authority must select its measure first.
    const rows = [
      listedQuote("anchor-venue", 5.25, "125ml"),
      listedQuote("anchor-venue", 5.5, "150ml"),
      listedQuote("anchor-venue", 6, "175ml"),
      listedQuote("anchor-venue", 7.5, "200ml"),
      listedQuote("anchor-venue", 8, "250ml"),
      listedQuote("same-measure-cheap", 6, "250ml", { drinkLabel: "Pinot Noir" }),
      listedQuote("same-measure-next", 7, "250ml", { drinkLabel: "Chardonnay" }),
    ];
    await withServingFixtures(venues, rows, async () => {
      const response = await generate({
        query: "cheap wine in Clapham for 2 after work",
        anchor: { ...ANCHOR, selectedDrinkPriceEvidence: selected },
      });
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ grounded: true, outcome: "route", anchored: true });
      expect(body.stops).toHaveLength(3);
      expect(body.stops[0]).toMatchObject({
        venueId: "anchor-venue", selectedDrinkPriceEvidence: selected,
      });
      expect(body.stops.map((stop: { venueId: string }) => stop.venueId))
        .toEqual(expect.arrayContaining(["anchor-venue", "same-measure-cheap", "same-measure-next"]));
      for (const stop of body.stops) {
        expect(stop.estimatedPintPricePence).toBeNull();
        expect(stop.priceEvidence).toBeNull();
        expect(stop.selectedDrinkPriceEvidence).toMatchObject({
          category: "wine", source: "listed", serving: "250ml", observedAt: SERVING_OBSERVED,
        });
      }
      expect(body.stops.find((stop: { venueId: string }) => stop.venueId === "same-measure-cheap"))
        .toMatchObject({ selectedDrinkPriceEvidence: {
          pence: 600, sourceUrl: "https://pub.example/same-measure-cheap/menu",
        } });
      expect(verifyAnchoredPlanGroundingProofV2(body.groundingProof,
        body.stops.map((stop: { venueId: string }) => stop.venueId), body.operationKey))
        .toMatchObject({ ok: true, anchored: true, outcome: "route" });
    });
  });

  it.each([
    ["amount", { ...SELECTED_LISTED, pence: 1 }],
    ["publisher link", { ...SELECTED_LISTED, sourceUrl: "https://attacker.example/menu" }],
    ["observation day", { ...SELECTED_LISTED, observedAt: "2026-09-28T12:00:00.000Z" }],
  ])("does not ground a valid-shape forged anchor %s hint", async (_field, hint) => {
    await withServingFixtures([claphamVenue("anchor-venue", 0)], [listedQuote("anchor-venue", 8, "125ml")], async () => {
      const response = await generate({ query: "wine in Clapham for 2", anchor: { ...ANCHOR, selectedDrinkPriceEvidence: hint } });
      const body = await response.json();
      expect(body.grounded).not.toBe(true);
      expect(body.stops ?? []).toEqual([]);
    });
  });

  it("does not ground an expired anchor quote even when every submitted field matches", async () => {
    const observedAt = "2025-09-29T12:00:00.000Z";
    await withServingFixtures([claphamVenue("anchor-venue", 0)], [listedQuote("anchor-venue", 8, "125ml", { observedAt })], async () => {
      const response = await generate({ query: "wine in Clapham for 2",
        anchor: { ...ANCHOR, selectedDrinkPriceEvidence: { ...SELECTED_LISTED, observedAt } } });
      const body = await response.json();
      expect(body.grounded).not.toBe(true);
      expect(body.stops ?? []).toEqual([]);
    });
  });

  it.each([
    ["explicit category", { drinkCategory: "gin" }, "gin"],
    ["zero-proof", { zeroProof: true }, null],
  ] as const)("preserves the %s override instead of reusing the accepted wine measure", async (_label, context, expectedCategory) => {
    const rows = [listedQuote("anchor-venue", 8, "125ml"),
      listedQuote("anchor-venue", 5, "25ml", { category: "gin", drinkLabel: "Sacred Gin" })];
    await withServingFixtures([claphamVenue("anchor-venue", 0)], rows, async () => {
      const response = await generate({ query: "wine in Clapham for 2", context,
        anchor: { ...ANCHOR, selectedDrinkPriceEvidence: SELECTED_LISTED } });
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.grounded).toBe(true);
      expect(body.stops).toHaveLength(1);
      if (expectedCategory) {
        expect(body.inferredContext.drinkCategory).toBe(expectedCategory);
        expect(body.stops[0].selectedDrinkPriceEvidence).toMatchObject({ category: "gin", pence: 500, serving: "25ml", source: "listed" });
      } else {
        expect(body.inferredContext.zeroProof).toBe(true);
        expect(body.stops[0].selectedDrinkPriceEvidence ?? null).toBeNull();
      }
    });
  });

  it.each([
    { ...SELECTED_LISTED, pence: 0 },
    { ...SELECTED_LISTED, category: "beer" },
    { ...SELECTED_LISTED, source: "estimate" },
    { ...SELECTED_LISTED, serving: " 125ml" },
  ])("rejects malformed selected anchor evidence before generation", async (selectedDrinkPriceEvidence) => {
    const response = await generate({ query: "wine in Clapham for 2", anchor: { ...ANCHOR, selectedDrinkPriceEvidence } });
    expect(response.status).toBe(400);
    expect(resolvePlanningAnchorMock).not.toHaveBeenCalled();
    expect(categoryIndexMock).not.toHaveBeenCalled();
  });

  it("keeps generic generation unanchored when no accepted Venue is supplied", async () => {
    const response = await generate({ query: "Four of us after work in Clapham, cheap and lively" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.grounded).toBe(true);
    expect(body.stops).toHaveLength(3);
    expect(body.outcome).toBeUndefined();
    expect(body.anchored).toBeUndefined();
    expect(resolvePlanningAnchorMock).not.toHaveBeenCalled();
  });

  it("handles an accepted Venue by default and returns it first with a valid V2 proof", async () => {
    resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
    loadConciergeVenuesMock.mockResolvedValueOnce([
      claphamVenue("anchor-venue", 0, { cheapestPrice: 5 }),
      claphamVenue("companion-1", 1, { cheapestPrice: 4 }),
      claphamVenue("companion-2", 2, { cheapestPrice: 4 }),
      claphamVenue("companion-3", 3, { cheapestPrice: 6 }),
    ]);
    const response = await generate({ intake: intake(), anchor: ANCHOR });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      grounded: true, outcome: "route", anchored: true, routeReady: true,
      anchorVenueId: "anchor-venue", anchorSource: "near",
    });
    expect(body.stops[0].venueId).toBe("anchor-venue");
    expect(body.stops[0].alternatives).toEqual([]);
    const verdict = verifyAnchoredPlanGroundingProofV2(
      body.groundingProof,
      body.stops.map((stop: { venueId: string }) => stop.venueId),
      body.operationKey,
    );
    expect(verdict).toMatchObject({ ok: true, anchored: true, outcome: "route", anchorVenueId: "anchor-venue" });
  });

  it("retains source-stated listed wine on an anchor-only draft without upgrading it to a route", async () => {
    const now = Date.parse("2026-09-30T12:00:00.000Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const observedAt = "2026-09-29T12:00:00.000Z";
    resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
    loadConciergeVenuesMock.mockResolvedValueOnce([claphamVenue("anchor-venue", 0)]);
    listedBundleFixture.status = "ready";
    listedBundleFixture.rows = [{ venueId: "anchor-venue", name: "Anchor", category: "wine", priceGbp: 6.25,
      drinkLabel: "Chenin", servingSize: "125ml", lane: "site-harvest", standing: "listed",
      sourceUrl: "https://pub.example/anchor/menu", observedAt, publisher: "Fixture publisher", basis: null, sampleSize: null }];
    try {
      const response = await generate({ query: "Quiet wine in Clapham for 2", anchor: ANCHOR });
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ outcome: "anchor-only", routeReady: false, anchorVenueId: "anchor-venue" });
      expect(body.stops).toHaveLength(1);
      expect(body.stops[0]).toMatchObject({ estimatedPintPricePence: null, priceEvidence: null,
        selectedDrinkPriceEvidence: { category: "wine", pence: 625, serving: "125ml", source: "listed",
          sourceUrl: "https://pub.example/anchor/menu", observedAt } });
      expect(verifyAnchoredPlanGroundingProofV2(body.groundingProof, ["anchor-venue"], body.operationKey))
        .toMatchObject({ ok: true, anchored: true, outcome: "anchor-only" });
    } finally { clock.mockRestore(); listedBundleFixture.rows = null; }
  });

  it("keeps corroborated wine evidence in an anchor-only draft", async () => {
    const now = Date.now();
    resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
    loadConciergeVenuesMock.mockResolvedValueOnce([claphamVenue("anchor-venue", 0)]);
    categoryIndexMock.mockResolvedValueOnce({
      prices: [{ venueId: "anchor-venue", drinkCategory: "wine", priceGbp: 6.75,
        submittedAt: now, source: "community", corroborations: 2 }],
      degraded: false, truncated: false,
    });
    const response = await generate({ query: "Quiet wine in Clapham for 2", anchor: ANCHOR });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.outcome).toBe("anchor-only");
    expect(body.stops).toHaveLength(1);
    expect(body.stops[0]).toMatchObject({
      estimatedPintPricePence: null, priceEvidence: null,
      selectedDrinkPriceEvidence: { category: "wine", pence: 675, serving: null,
        source: "community", reportedAt: new Date(now).toISOString() },
    });
  });

  it("returns anchor-only when companions are insufficient", async () => {
    resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
    loadConciergeVenuesMock.mockResolvedValueOnce([
      claphamVenue("anchor-venue", 0),
      claphamVenue("companion-1", 1),
    ]);
    const response = await generate({ intake: intake(), anchor: ANCHOR });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      grounded: true, outcome: "anchor-only", anchored: true, routeReady: false,
      reason: "ANCHOR_COMPANIONS_INSUFFICIENT", anchorVenueId: "anchor-venue",
    });
    expect(body.stops).toHaveLength(1);
    expect(body.stops[0].venueId).toBe("anchor-venue");
    const verdict = verifyAnchoredPlanGroundingProofV2(body.groundingProof, ["anchor-venue"], body.operationKey);
    expect(verdict).toMatchObject({ ok: true, outcome: "anchor-only", anchored: true });
  });

  it("surfaces a resolver conflict as an anchor-conflict outcome", async () => {
    resolvePlanningAnchorMock.mockResolvedValue({
      status: "conflict", code: "ANCHOR_AREA_CONFLICT", message: "outside area",
    });
    const response = await generate({ intake: intake(), anchor: ANCHOR });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      grounded: false, outcome: "anchor-conflict", anchored: true, routeReady: false,
      stops: [], reason: "ANCHOR_AREA_CONFLICT",
    });
  });

  it("returns a route conflict when the anchor is absent from the area candidates", async () => {
    resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
    loadConciergeVenuesMock.mockResolvedValueOnce([
      claphamVenue("companion-1", 1),
      claphamVenue("companion-2", 2),
      claphamVenue("companion-3", 3),
    ]);
    const response = await generate({ intake: intake(), anchor: ANCHOR });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      grounded: false, outcome: "anchor-conflict", reason: "ANCHOR_ROUTE_CONFLICT",
    });
  });
});


describe("anchored generation for an accepted canonical UK base pub", () => {
  beforeEach(() => {
    isLimitedMock.mockReset(); isLimitedMock.mockResolvedValue(false);
    loadConciergeVenuesMock.mockClear(); resolvePlanningAnchorMock.mockReset();
    categoryIndexMock.mockReset();
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: false, truncated: false });
    process.env.PLAN_IDEMPOTENCY_SECRET = "a".repeat(48);
  });
  afterEach(() => { basePlanPack.result = { status: "missing" }; delete process.env.PLAN_IDEMPOTENCY_SECRET; });

  it("keeps the real base pub as an honest anchor-only draft when no curated companions exist", async () => {
    basePlanPack.result = { status: "ready", pub: basePlanPack.pub };
    resolvePlanningAnchorMock.mockImplementation(async (input) => {
      const actual = await vi.importActual<typeof import("@/lib/planningAnchor.server")>("@/lib/planningAnchor.server");
      return actual.resolvePlanningAnchor(input);
    });
    loadConciergeVenuesMock.mockResolvedValueOnce([]);
    const response = await generate({ query: "Quiet wine in Soho for two", cityId: "london",
      anchor: { venueId: basePlanPack.pub.id, source: "near", acceptedArea: null, startsAt: null } });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ grounded: true, outcome: "anchor-only", anchored: true,
      routeReady: false, anchorVenueId: basePlanPack.pub.id });
    expect(body.stops).toHaveLength(1);
    expect(body.stops[0]).toMatchObject({ venueId: basePlanPack.pub.id, venueName: basePlanPack.pub.name,
      estimatedPintPricePence: null, priceEvidence: null });
    expect(verifyAnchoredPlanGroundingProofV2(body.groundingProof, [basePlanPack.pub.id], body.operationKey))
      .toMatchObject({ ok: true, anchored: true, outcome: "anchor-only", anchorVenueId: basePlanPack.pub.id });
  });
});
