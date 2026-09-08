import { beforeEach, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ index: vi.fn(), places: vi.fn() }));
vi.mock("@/lib/cities", () => ({ CITIES: { london: { id: "london" }, manchester: { id: "manchester" } } }));
vi.mock("@/lib/venueIndex", () => ({ readCityVenueIndex: fixtures.index }));
vi.mock("@/lib/cultureCrawl.server", () => ({ cultureWaypointPois: fixtures.places }));
import { planGroupOutcomeScope } from "@/lib/planGroupOutcomeScope.server";

beforeEach(() => {
  fixtures.index.mockReset().mockImplementation(async (city: { id: string }) => new Map([[city.id === "london" ? "listed-london" : "listed-manchester", {}]]));
  fixtures.places.mockReset().mockImplementation((city: string) => [{ id: `${city}-place` }]);
});

it.each([
  [["listed-london"], "london"],
  [["listed-manchester"], "other_city"],
  [["listed-london", "listed-manchester"], "mixed"],
  [["place:london-place", "listed-london"], "london"],
  [["place:manchester-place"], "other_city"],
  [["venue-uk-unresolved"], "unknown"],
  [["unprefixed-id"], "unknown"],
  [[], "unknown"],
] as const)("derives %s only from city pack membership", async (ids, expected) => {
  expect(await planGroupOutcomeScope(ids.map(venueId => ({ venueId })))).toBe(expected);
});

it("does not infer London when another city pack could not answer", async () => {
  fixtures.index.mockImplementation(async (city: { id: string }) => city.id === "london" ? new Map([["listed-london", {}]]) : null);
  expect(await planGroupOutcomeScope([{ venueId: "listed-london" }])).toBe("unknown");
});

it("refuses a venue ID that occurs in two city packs", async () => {
  fixtures.index.mockResolvedValue(new Map([["ambiguous", {}]]));
  expect(await planGroupOutcomeScope([{ venueId: "ambiguous" }])).toBe("unknown");
});

it("refuses an ambiguous culture waypoint", async () => {
  fixtures.places.mockReturnValue([{ id: "ambiguous" }]);
  expect(await planGroupOutcomeScope([{ venueId: "place:ambiguous" }])).toBe("unknown");
});

it("preserves unavailable location evidence without blocking completion", async () => {
  fixtures.index.mockRejectedValue(new Error("Missing pack"));
  expect(await planGroupOutcomeScope([{ venueId: "listed-london" }])).toBe("unknown");
});
