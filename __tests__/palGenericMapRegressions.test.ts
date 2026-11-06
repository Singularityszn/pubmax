import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConciergeVenue } from "@/lib/concierge/rank";

// A keyed venue resolver can map any leftover words to a listed pub. Production
// mapped the words of "OK. Show me the map" to Me'An O'Brien's this way, so the
// map tool must not resolve a pub from a request that names none.
const resolver = vi.hoisted(() => ({ match: vi.fn() }));
vi.mock("@/lib/ask/venueResolution.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ask/venueResolution.server")>();
  return { ...actual, matchVenueByName: resolver.match };
});

const MEAN: ConciergeVenue = {
  id: "venue-mean", name: "Me'An O'Brien's", area: "Soho", lat: 51.51, lng: -0.13,
  cheapestPrice: 5, priceSource: "Pub menu", priceObservedAt: "2026-01-01",
  amenities: {},
} as ConciergeVenue;

vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: vi.fn(async () => [MEAN]),
}));

import { resolveAskPriceIntent, routeAskDeterministically } from "@/lib/ask/routingPolicy";
import { semanticAskRequest } from "@/lib/ask/requestPolicy";
import { runAskTool } from "@/lib/ask/tools";
import { palVoiceMapIntent } from "@/lib/palVoiceTranscript";

const ctx = (query: string) => ({ cityId: "london" as const, query, skipModel: true, now: Date.UTC(2026, 10, 6, 19) });

beforeEach(() => {
  resolver.match.mockReset();
  resolver.match.mockResolvedValue(MEAN);
});

describe("a generic map command names no pub", () => {
  it.each(["OK. Show me the map", "Alright, show me the map", "Hi. Show me the map", "Show me the map"])(
    "routes %s without a pub name and answers without a pub", async (query) => {
      const calls = routeAskDeterministically(query);
      expect(calls).toEqual([{ name: "propose_map_action", args: { query } }]);
      const result = await runAskTool("propose_map_action", calls[0]!.args, ctx(query));
      expect(result.cards).toEqual([]);
      expect(result.proposals).toEqual([]);
      expect(result.answerHint).not.toContain("Me'An");
      expect(resolver.match).not.toHaveBeenCalled();
    },
  );

  it("ignores a pub name a model attached to a generic map command", async () => {
    const result = await runAskTool("propose_map_action", { venueName: "OK. me map" }, ctx("OK. Show me the map"));
    expect(result.proposals).toEqual([]);
    expect(resolver.match).not.toHaveBeenCalled();
  });

  it("still opens a pub the person names", async () => {
    const result = await runAskTool("propose_map_action", { venueName: "Me'An O'Brien's" }, ctx("Show Me'An O'Brien's on the map"));
    expect(result.proposals.map((proposal) => proposal.kind)).toEqual(["open_venue", "fly_to"]);
  });

  it.each(["Show me the map. Please stop.", "Map, not yet", "Show me the map, hold off"])(
    "proposes no map move for a refused command: %s", (query) => {
      expect(routeAskDeterministically(query).map(({ name }) => name)).not.toContain("propose_map_action");
    },
  );
});

describe("map commands keep navigation beside ordinary words", () => {
  it.each([
    "Show me the map, I'm not sure where I am",
    "Show me the map and the date",
    "OK. Show me the map",
  ])("opens the map for %s", (query) => {
    expect(palVoiceMapIntent(query, false)).toBe("map");
  });

  it("keeps the map command beside a date field", () => {
    expect(semanticAskRequest("Show me the map and the date")).toBe("Show me the map");
  });

  it("reads cheap pints beside a map command as a supported pint ask", () => {
    const service = semanticAskRequest("Show me the map with cheap pints", false);
    expect(resolveAskPriceIntent(service).kind).not.toBe("unsupported");
  });
});

describe("price-evidence wording is presentation, not a price subject", () => {
  it.each([
    "Find three quiet pubs in Soho for tonight, with the source and date for any price you use.",
    "Find three quiet pubs in Soho for tonight. Include the source and date of each price.",
    "Find three quiet pubs in Soho for tonight. Please show the price source and date.",
    "Find three quiet pubs in Soho for tonight and cite the source for any price.",
  ])("finds three pubs for %s", (query) => {
    expect(resolveAskPriceIntent(semanticAskRequest(query, false)).kind).not.toBe("unsupported");
    expect(routeAskDeterministically(query)).toEqual([
      { name: "search_venues", args: { query, limit: 3 } },
    ]);
  });

  it("keeps a real price question on the price path", () => {
    expect(routeAskDeterministically("How much is a pint at The Lamb? Show the source and date.")[0]?.name).toBe("venue_prices");
  });
});
