// A Plan Stop id is a listed venue OR a `place:<poi id>` meeting point, and
// nothing else. Open plans are the reason the second shape exists: the host
// picks a named public place, and the stop write has to be able to store it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const committedPacks = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/concierge/venues.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/venues.server")>();
  return {
    loadConciergeVenues: vi.fn(async (cityId: string) =>
      committedPacks.enabled
        ? actual.loadConciergeVenues(cityId as import("@/lib/cities").CityId)
        : cityId === "london"
          ? [
              { id: "venue-angel-islington", name: "The Angel" },
              { id: "venue-camden-arms", name: "Camden Arms" },
              { id: "venue-soho-tavern", name: "Soho Tavern" },
            ]
          : [],
    ),
  };
});

vi.mock("@/lib/cultureCrawl.server", () => ({
  cultureWaypointPois: (cityId: string) =>
    cityId === "london"
      ? [
          {
            id: "tube-kings-cross-st-pancras",
            name: "King's Cross St Pancras",
            category: "tube",
            coordinates: [-0.124, 51.5308],
          },
        ]
      : [],
}));

import { canonicalPlanRoute, planStopResolver } from "@/lib/planRoute";
import { resolvePlanningAnchor } from "@/lib/planningAnchor.server";

describe("plan stop ids", () => {
  it("stores a named public place under its canonical POI name", async () => {
    const resolve = await planStopResolver("london");
    expect(resolve({ venueId: "place:tube-kings-cross-st-pancras" })).toEqual({
      venueId: "place:tube-kings-cross-st-pancras",
      venueName: "King's Cross St Pancras",
    });
  });

  it("refuses a place id the POI layer does not hold, and free text", async () => {
    const resolve = await planStopResolver("london");
    expect(resolve({ venueId: "place:nowhere-at-all" })).toBeNull();
    expect(resolve({ venueId: "place:" })).toBeNull();
    expect(resolve({ venueId: "by the canal near the bridge" })).toBeNull();
    expect(resolve({ venueId: "venue-not-listed" })).toBeNull();
  });

  it("rebuilds a route whose Stop 1 is a place", async () => {
    await expect(
      canonicalPlanRoute([
        { venueId: "place:tube-kings-cross-st-pancras" },
        { venueId: "venue-camden-arms" },
        { venueId: "venue-soho-tavern" },
      ]),
    ).resolves.toEqual([
      {
        venueId: "place:tube-kings-cross-st-pancras",
        venueName: "King's Cross St Pancras",
        position: 0,
      },
      { venueId: "venue-camden-arms", venueName: "Camden Arms", position: 1 },
      { venueId: "venue-soho-tavern", venueName: "Soho Tavern", position: 2 },
    ]);
  });

  it("refuses a whole route when one stop does not resolve", async () => {
    await expect(
      canonicalPlanRoute([
        { venueId: "venue-angel-islington" },
        { venueId: "place:nowhere-at-all" },
        { venueId: "venue-soho-tavern" },
      ]),
    ).resolves.toBeNull();
  });

  it("refuses a route that names the same place twice", async () => {
    await expect(
      canonicalPlanRoute([
        { venueId: "place:tube-kings-cross-st-pancras" },
        { venueId: "place:tube-kings-cross-st-pancras" },
        { venueId: "venue-soho-tavern" },
      ]),
    ).resolves.toBeNull();
  });
});

describe("committed UK base pub and curated alias Plan identities", () => {
  // Shipped Westminster Arms row: packs/a917f46cc28c0e9e/51.500_-0.250.json.
  // Both readers below consume committed packs, rather than synthesising an alias.
  const baseId = "venue-uk-w545664029";
  const curatedId = "venue-u5unwx";
  const blackfriarId = "venue-eltcmh";

  beforeEach(() => { committedPacks.enabled = true; });
  afterEach(() => { committedPacks.enabled = false; });

  it("keeps an accepted base pub identity when its curated alias also resolves", async () => {
    const resolve = await planStopResolver("london", [{ venueId: baseId }]);
    expect(resolve({ venueId: curatedId })).toEqual({ venueId: curatedId, venueName: "Westminster Arms" });
    expect(resolve({ venueId: baseId, venueName: "Client name" })).toEqual({
      venueId: baseId, venueName: "Westminster Arms",
    });
  });

  it("preserves submitted base and curated stop order with server-owned names", async () => {
    await expect(canonicalPlanRoute([
      { venueId: baseId, venueName: "Client first" },
      { venueId: blackfriarId, venueName: "Client second" },
    ], "london")).resolves.toEqual([
      { venueId: baseId, venueName: "Westminster Arms", position: 0 },
      { venueId: blackfriarId, venueName: "The Blackfriar", position: 1 },
    ]);
  });

  it("keeps an unaliased committed base pub identity", async () => {
    await expect(canonicalPlanRoute([{ venueId: "venue-uk-n8308248176", venueName: "Client name" }], "london"))
      .resolves.toEqual([{ venueId: "venue-uk-n8308248176", venueName: "The Sydney Arms", position: 0 }]);
  });

  it("preserves a valid base backup identity without duplicating an active pub", async () => {
    await expect(canonicalPlanRoute([
      { venueId: blackfriarId, alternatives: [{ venueId: baseId, venueName: "Client backup" }] },
    ], "london")).resolves.toEqual([
      { venueId: blackfriarId, venueName: "The Blackfriar", position: 0,
        alternatives: [{ venueId: baseId, venueName: "Westminster Arms" }] },
    ]);
  });

  it.each([
    ["missing base id", "venue-uk-w999999999999", "london"],
    ["outside requested city", baseId, "manchester"],
    ["committed bar", "venue-uk-n6050608743", "london"],
  ] as const)("refuses %s even though base ids have valid syntax", async (_reason, venueId, cityId) => {
    await expect(canonicalPlanRoute([{ venueId }], cityId)).resolves.toBeNull();
  });

  it.each([
    { label: "active stops", stops: [{ venueId: baseId }, { venueId: curatedId }] },
    { label: "active stop and backup", stops: [{ venueId: baseId, alternatives: [{ venueId: curatedId }] }, { venueId: blackfriarId }] },
    { label: "two backups", stops: [{ venueId: blackfriarId, alternatives: [{ venueId: baseId }, { venueId: curatedId }] }] },
  ])("refuses repeated physical pubs across base/curated $label", async ({ stops }) => {
    await expect(canonicalPlanRoute(stops, "london")).resolves.toBeNull();
  });

  it("does not inherit curated price or accessibility authority for an accepted base pub", async () => {
    const input = { cityId: "london" as const, venueId: baseId, startsAt: null, acceptedArea: null };
    const resolved = await resolvePlanningAnchor(input);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") throw new Error("Committed base anchor did not resolve");
    expect(resolved.display).toMatchObject({ venueId: baseId, priceEvidence: null });
    expect(resolved.canonical).toMatchObject({ venueId: baseId, priceObservedAt: null, priceFreshnessKind: "unknown" });
    expect(await resolvePlanningAnchor({ ...input, budgetPerPersonPence: 500 })).toMatchObject({
      status: "conflict", code: "ANCHOR_BUDGET_CONFLICT",
    });
    expect(await resolvePlanningAnchor({ ...input, requiresStepFreeAccess: true })).toMatchObject({
      status: "conflict", code: "ANCHOR_ACCESS_CONFLICT",
    });
  });
});
