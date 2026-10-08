import { describe, expect, it, vi } from "vitest";

import { runAskTool } from "@/lib/ask/tools";
import {
  collectVenueNameCandidates,
  matchVenueByNameKeyless,
  matchVenueNameWithinQuery,
  uniqueExactVenueNameMatch,
} from "@/lib/ask/venueResolution";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { searchCuratedVenues } from "@/lib/curatedVenueSearch.server";
import { filterMapVenues } from "@/lib/filterMapVenues";
import { buildMapSearchIndex, searchMapSearchIndex } from "@/lib/mapSearchIndex";
import { buildMapSearchSuggestions } from "@/lib/mapSearchSuggest";
import { canonicalizeSaved } from "@/lib/savedPubs";
import { slimVenueToPin } from "@/lib/slimPins";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { groupVenuePrices, initialFilters, type VenuePrice } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";
import dataset from "@/public/data/pint_prices_app_dataset.json";
import slimDataset from "@/public/data/venues_slim.json";

vi.mock("@/lib/ai/typesafe.server", () => ({
  systemOne: async () => null,
}));

vi.mock("@/lib/communityPriceStore", () => ({
  readCommunityPricesWithStatus: async () => ({ prices: [], degraded: false }),
}));

describe("published Blackfriar identity", () => {
  const canonicalId = "venue-eltcmh";
  const fullVenues = groupVenuePrices(dataset as VenuePrice[]);
  const slimVenues = (slimDataset.rows as SlimVenue[]).map(slimVenueToPin);

  for (const query of ["The Blackfriar", "The Black Friar", "the black friar", "The Black Friar, Blackfriars"]) {
    it(`finds one canonical Map venue for ${query} before and after hydration`, () => {
      for (const venues of [slimVenues, fullVenues]) {
        const filtered = filterMapVenues(venues, { ...initialFilters, query }, () => false);
        expect(filtered.map((venue) => venue.id)).toEqual([canonicalId]);
        expect(filtered[0]?.cheapestPrice).toBe(6.5);
        const suggestions = buildMapSearchSuggestions({
          cityId: "london", query, venues, userLocation: null,
          mapCenter: [-0.103677, 51.5121],
        });
        expect(suggestions.pubs.map((venue) => venue.id)).toEqual([canonicalId]);
      }
    });

    it(`finds one canonical Map index and curated result for ${query}`, async () => {
      const index = buildMapSearchIndex([{ id: "london", displayName: "London" }], [{
        cityId: "london",
        venues: slimVenues.map((venue) => ({
          id: venue.id, name: venue.name, area: venue.primaryBorough,
        })),
      }]);
      expect(searchMapSearchIndex(index, query)
        .filter((result) => result.kind === "venue")
        .map((result) => result.id)).toEqual([canonicalId]);
      expect((await searchCuratedVenues(query, 12)).map((venue) => venue.id)).toEqual([canonicalId]);
    });

    it(`resolves ${query} through every Pal name-matching mode`, async () => {
      const venues = await loadConciergeVenues("london");
      expect(uniqueExactVenueNameMatch(venues, query)?.id).toBe(canonicalId);
      expect(matchVenueByNameKeyless(venues, query)?.id).toBe(canonicalId);
      expect(collectVenueNameCandidates(venues, query)[0]?.id).toBe(canonicalId);
      expect(matchVenueNameWithinQuery(venues, `How much is a pint at ${query}?`)?.id).toBe(canonicalId);

      for (const tool of ["venue_prices", "venue_drinks", "propose_map_action"]) {
        const answer = await runAskTool(tool, { venueName: query }, {
          cityId: "london", query: "", skipModel: true,
        });
        expect(answer.ok).toBe(true);
        expect(answer.data).toMatchObject({ venueId: canonicalId });
        expect(answer.cards.map((card) => card.venueId)).toEqual([canonicalId]);
      }
    });
  }

  it("answers a name-only Pal price question with the canonical listed price", async () => {
    const answer = await runAskTool("venue_prices", {}, {
      cityId: "london", query: "How much is a pint at The Black Friar?", skipModel: true,
    });
    expect(answer.ok).toBe(true);
    expect(answer.data).toMatchObject({ venueId: canonicalId, curatedPrice: 6.5 });
  });

  it("does not assign the spelling alias to another venue identity", () => {
    const unrelated = { id: "another-pub", name: "The Blackfriar", area: "London" };
    expect(uniqueExactVenueNameMatch([unrelated], "The Black Friar")).toBeNull();
    expect(matchVenueByNameKeyless([unrelated], "The Black Friar")).toBeNull();
    expect(collectVenueNameCandidates([unrelated], "The Black Friar")).toEqual([]);
  });

  it("keeps a Pub Pal tool card with the old id resolvable", async () => {
    const answer = await runAskTool("venue_prices", { venueId: "venue-1sw9ofl" }, {
      cityId: "london", query: "", skipModel: true,
    });
    expect(answer.ok).toBe(true);
    expect(answer.data).toMatchObject({ venueId: "venue-eltcmh", curatedPrice: 6.5 });
    expect(answer.cards.map((card) => card.venueId)).toContain("venue-eltcmh");
  });

  it("preserves saved notes and lists through the published alias", async () => {
    const aliases = await loadVenueAliasResolver();
    const saved = {
      venueId: "venue-1sw9ofl", listType: "Want to Visit", note: "Friday route",
      savedAt: "2026-10-04T12:00:00.000Z",
    };
    expect(canonicalizeSaved([
      saved,
      { ...saved, venueId: "venue-eltcmh" },
      { ...saved, listType: "My Friday pubs" },
    ], aliases.canonical)).toEqual([
      { ...saved, venueId: "venue-eltcmh" },
      { ...saved, venueId: "venue-eltcmh", listType: "My Friday pubs" },
    ]);
  });
});
