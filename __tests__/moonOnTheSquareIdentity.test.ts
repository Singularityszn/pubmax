import { describe, expect, it } from "vitest";

import { filterMapVenues } from "@/lib/filterMapVenues";
import { slimVenueToPin } from "@/lib/slimPins";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { groupVenuePrices, initialFilters, type VenuePrice } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";
import dataset from "@/public/data/pint_prices_app_dataset.json";
import slimDataset from "@/public/data/venues_slim.json";

describe("published Moon on the Square identity", () => {
  const canonicalId = "venue-86sj0g";
  const retiredId = "venue-g9jxzs";
  const fullVenues = groupVenuePrices(dataset as VenuePrice[]);
  const slimVenues = (slimDataset.rows as SlimVenue[]).map(slimVenueToPin);

  it("draws one priced pin before and after hydration", () => {
    for (const venues of [slimVenues, fullVenues]) {
      const filtered = filterMapVenues(venues, { ...initialFilters, query: "Moon on the Square" }, () => false);
      expect(filtered.map((venue) => venue.id)).toEqual([canonicalId]);
      expect(filtered[0]?.cheapestPrice).toBe(2.43);
      expect(venues.some((venue) => venue.id === retiredId)).toBe(false);
    }
  });

  it("resolves the retired Wetherspoon id to the OSM pin", async () => {
    const aliases = await loadVenueAliasResolver();
    expect(aliases.canonical(retiredId)).toBe(canonicalId);
  });
});
