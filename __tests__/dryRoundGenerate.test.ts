import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// THE DRY ROUND THROUGH THE ONE GENERATION PATH (lib/dryRound.ts). Every stop
// and every swap lists an alcohol-free price, each carries its pint beside it,
// too few listed pubs is a sentence naming them, and a read that failed is
// never an empty area.

const {
  isLimitedMock,
  loadConciergeVenuesMock,
  categoryIndexMock,
  listedRowsMock,
  resolvePlanningAnchorMock,
} = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async () => false),
  loadConciergeVenuesMock: vi.fn(),
  categoryIndexMock: vi.fn(),
  listedRowsMock: vi.fn(),
  resolvePlanningAnchorMock: vi.fn(),
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
// The listed alcohol-free lane is the /near reader. Here it answers the rows a
// test hands it, so which pubs list a price is the test's own choice.
vi.mock("@/lib/nearCheapestAnything.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nearCheapestAnything.server")>();
  return { ...actual, loadListedAlcoholFreeRows: listedRowsMock };
});
// Each pub's pint is a labelled test fixture, except the one pub that has none.
vi.mock("@/lib/planRouteEvidence.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planRouteEvidence.server")>();
  const { buildPriceEvidence } = await vi.importActual<typeof import("@/lib/planRouteEvidence")>(
    "@/lib/planRouteEvidence",
  );
  return {
    ...actual,
    planPriceEvidenceForVenues: async (
      venues: Parameters<typeof actual.planPriceEvidenceForVenues>[0],
      now: number,
    ) => new Map(venues.map((venue) => [venue.id, venue.id === "listed-3"
      ? { pence: null, source: null, confidenceState: "unknown" as const }
      : buildPriceEvidence({
        pence: 610,
        label: "Test fixture pint price",
        url: "https://example.org/test-fixture/pint-prices",
        observedAt: new Date(now - 60 * 60 * 1000).toISOString(),
        now,
      })])),
  };
});

import { POST } from "@/app/api/plans/generate/route";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { DRY_ROUND_ANCHOR_UNLISTED_LINE, DRY_ROUND_UNREAD_LINE, dryRoundQuery } from "@/lib/dryRound";
import type { NearDrinkRow } from "@/lib/nearCheapestAnything";
import {
  createPlanIntakeDraft,
  planIntakeHandoff,
  skipRemainingPlanIntake,
} from "@/lib/planIntake";

function claphamVenue(id: string, index: number, options: Partial<ConciergeVenue> = {}): ConciergeVenue {
  return {
    id,
    name: `The ${id}`,
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

/** Pubs that list an alcohol-free price sit between pubs that do not, so a padded route would show. */
const VENUES = [
  claphamVenue("unlisted-1", 0, { cheapestPrice: 3 }),
  claphamVenue("listed-1", 1),
  claphamVenue("unlisted-2", 2, { cheapestPrice: 3 }),
  claphamVenue("listed-2", 3),
  claphamVenue("unlisted-3", 4, { cheapestPrice: 3 }),
  claphamVenue("listed-3", 5),
  claphamVenue("listed-4", 6),
];

function row(venueId: string, priceGbp: number): NearDrinkRow {
  return [venueId, priceGbp, "2026-10-13", "Example pub menu", "Lucky Saint", "bottle"];
}

const LISTED_ROWS = [row("listed-1", 4.5), row("listed-2", 4.8), row("listed-3", 5.1), row("listed-4", 5.2)];
const LISTED_IDS = new Set(LISTED_ROWS.map(([id]) => id));

const DESCRIBE_FIRST_INTAKE = planIntakeHandoff(skipRemainingPlanIntake(createPlanIntakeDraft()));

async function generate(body: Record<string, unknown>) {
  const response = await POST(new Request("http://localhost/api/plans/generate", {
    method: "POST",
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

type WireStop = { venueId: string; alternatives: { venueId: string }[] };

describe("the dry round through POST /api/plans/generate", () => {
  beforeEach(() => {
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValue(false);
    loadConciergeVenuesMock.mockReset();
    loadConciergeVenuesMock.mockResolvedValue(VENUES);
    categoryIndexMock.mockReset();
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: false, truncated: false });
    listedRowsMock.mockReset();
    listedRowsMock.mockResolvedValue(LISTED_ROWS);
    resolvePlanningAnchorMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["the describe-first body", { intake: DESCRIBE_FIRST_INTAKE }],
    ["a bare ask", {}],
  ])("plans listed alcohol-free stops only, with %s", async (_label, extra) => {
    const { status, body } = await generate({ query: dryRoundQuery("Clapham for 3"), ...extra });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.stops).toHaveLength(3);
    const stops = body.stops as WireStop[];
    for (const stop of stops) {
      expect(LISTED_IDS.has(stop.venueId), `${stop.venueId} lists no alcohol-free price`).toBe(true);
      for (const alternative of stop.alternatives) expect(LISTED_IDS.has(alternative.venueId)).toBe(true);
    }
    expect(body.inferredContext.zeroProof).toBe(true);
    expect(body.contextEffects).toContain("dryRound");
    // Every stop lists an alcohol-free price, so the planner does not ask the
    // reader to go and check that there is one.
    expect(body.missingContextEvidence).not.toContain("zero_proof_options");
  });

  it("carries each stop's listed alcohol-free price with its pint beside it", async () => {
    const { status, body } = await generate({ query: dryRoundQuery("Clapham for 3"), intake: DESCRIBE_FIRST_INTAKE });
    expect(status, JSON.stringify(body)).toBe(200);
    const byVenue = new Map<string, { alcoholFree: Record<string, unknown>; pint: Record<string, unknown> | null }>(
      body.dryRound.venues.map((entry: { venueId: string }) => [entry.venueId, entry]),
    );
    const offered = (body.stops as WireStop[]).flatMap((stop) => [stop.venueId, ...stop.alternatives.map(({ venueId }) => venueId)]);
    // Every stop and every swap offered carries its prices, and the four
    // listed pubs are all offered, so the pub with no pint is among them.
    expect(new Set(offered)).toEqual(LISTED_IDS);
    for (const venueId of offered) {
      const entry = byVenue.get(venueId);
      expect(entry, `${venueId} has no dry round prices`).toBeDefined();
      expect(entry!.alcoholFree).toMatchObject({
        drinkLabel: "Lucky Saint",
        measure: "bottle",
        publisher: "Example pub menu",
        observedOn: "2026-10-13",
      });
      if (venueId === "listed-3") {
        expect(entry!.pint).toBeNull();
      } else {
        expect(entry!.pint).toMatchObject({ pence: 610, publisher: "Test fixture pint price", observedAt: expect.any(String) });
      }
    }
    // The stops themselves stay an alcohol-free night: no pint total is summed.
    for (const stop of body.stops) expect(stop.estimatedPintPricePence).toBeNull();
  });

  it("is alcohol-free whatever the context says once the ask names a dry round", async () => {
    const { status, body } = await generate({
      query: "dry round in Clapham for 3",
      intake: DESCRIBE_FIRST_INTAKE,
      context: { zeroProof: false },
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.inferredContext.zeroProof).toBe(true);
    for (const stop of body.stops as WireStop[]) expect(LISTED_IDS.has(stop.venueId)).toBe(true);
  });

  it("names the few listed pubs instead of padding the route", async () => {
    listedRowsMock.mockResolvedValue([row("listed-1", 4.5)]);
    const { status, body } = await generate({ query: dryRoundQuery("Clapham for 3"), intake: DESCRIBE_FIRST_INTAKE });
    expect(status).toBe(422);
    expect(body).toMatchObject({
      code: "DRY_ROUND_TOO_FEW",
      details: { nightArea: "clapham", listedVenueCount: 1, requestedStopCount: 3 },
    });
    expect(body.error).toBe(
      "Only The listed-1 in Clapham lists an alcohol-free price, too few for a 3-stop dry round. Try 1 stop, or another area.",
    );
    expect(body).not.toHaveProperty("stops");
  });

  it("says an area lists none rather than planning one", async () => {
    listedRowsMock.mockResolvedValue([]);
    const { status, body } = await generate({ query: dryRoundQuery("Clapham for 3"), intake: DESCRIBE_FIRST_INTAKE });
    expect(status).toBe(422);
    expect(body.code).toBe("DRY_ROUND_TOO_FEW");
    expect(body.error).toMatch(/^No pub in Clapham lists an alcohol-free price yet/);
  });

  it("plans the one listed pub when the reader asks for one stop", async () => {
    listedRowsMock.mockResolvedValue([row("listed-1", 4.5)]);
    const { status, body } = await generate({
      query: dryRoundQuery("Clapham for 3"),
      intake: DESCRIBE_FIRST_INTAKE,
      context: { stopCount: 1 },
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.stops.map((stop: WireStop) => stop.venueId)).toEqual(["listed-1"]);
  });

  it("answers a read that failed as a failed read, never as an empty area", async () => {
    listedRowsMock.mockResolvedValue(null);
    const { status, body } = await generate({ query: dryRoundQuery("Clapham for 3"), intake: DESCRIBE_FIRST_INTAKE });
    expect(status).toBe(503);
    expect(body).toMatchObject({ code: "DRY_ROUND_PRICES_UNAVAILABLE", retryable: true, error: DRY_ROUND_UNREAD_LINE });
  });

  it("refuses a kept pub that lists no alcohol-free price, and says why", async () => {
    resolvePlanningAnchorMock.mockResolvedValue({
      status: "resolved",
      display: {
        venueId: "unlisted-1", venueName: "Anchor", areaName: "Clapham", startLabel: null,
        priceEvidence: null, routeWindowOk: true, budgetCompatible: true, accessibilityCompatible: true,
      },
      canonical: {
        cityId: "london", venueId: "unlisted-1", nightAreaSlug: "clapham-high-street",
        acceptedArea: { kind: "night-patch", id: "clapham" },
        coordinates: { lat: 51.462, lng: -0.138 }, startsAt: null, priceObservedAt: null, priceFreshnessKind: "unknown",
      },
    });
    const { status, body } = await generate({
      query: dryRoundQuery("Clapham for 3"),
      intake: DESCRIBE_FIRST_INTAKE,
      anchor: { venueId: "unlisted-1", source: "near", acceptedArea: { kind: "night-patch", id: "clapham" }, startsAt: null },
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ outcome: "anchor-conflict", reason: "DRY_ROUND_ANCHOR_UNLISTED", message: DRY_ROUND_ANCHOR_UNLISTED_LINE });
    expect(body.stops).toEqual([]);
  });

  it("leaves an ordinary ask alone: no listed read, no dry round block", async () => {
    const { status, body } = await generate({ query: "Clapham for 3", intake: DESCRIBE_FIRST_INTAKE });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(listedRowsMock).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty("dryRound");
    expect(body.contextEffects).not.toContain("dryRound");
  });
});
