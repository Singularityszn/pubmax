// The historic SpoonMe record identifies the closed Kentish Drovers as a
// Wetherspoon, but the pub must not appear in current recommendations.

import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";

import { readSpoonsValue } from "@/lib/spoonsValue.server";
import {
  tonightCheapPintChain,
  tonightCheapPints,
  tonightWetherspoonVenueIds,
} from "@/lib/tonightCheapPints";
import { getPricedVenues, resetVenuePriceIndexForTests } from "@/lib/venuePriceIndex";
import { matchedWetherspoonsVenueIds } from "@/lib/wetherspoonsMatch.server";
import { defined } from "@/__tests__/helpers/defined";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const KENTISH_DROVERS = { name: "The Kentish Drovers", postcode: "SE15 5RS" } as const;

const compactPostcode = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, "").toUpperCase();

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function tonightInputs() {
  const [venues, spoonsValue] = await Promise.all([getPricedVenues(), readSpoonsValue()]);
  expect(spoonsValue.status).toBe("ready");
  const directoryIds = await matchedWetherspoonsVenueIds(
    venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      lat: venue.latitude,
      lng: venue.longitude,
    })),
  );
  const packRows = spoonsValue.pack?.rows ?? [];
  const spoonMeIds: ReadonlySet<string> = new Set(spoonsValue.byVenueId.keys());

  // The pub is found through the PACK by name and postcode, because the priced
  // index's own address for it carries no postcode.
  const kentishPackRows = packRows.filter(
    (row) =>
      row.name === KENTISH_DROVERS.name &&
      compactPostcode(row.postcode) === compactPostcode(KENTISH_DROVERS.postcode),
  );
  expect(kentishPackRows).toHaveLength(1);
  const historicRows = JSON.parse(await readFile(new URL("../public/data/pint_prices_app_dataset.json", import.meta.url), "utf8")) as VenuePrice[];
  const kentish = groupVenuePrices(historicRows).find((venue) => venue.id === defined(kentishPackRows[0]).venueId);
  expect(kentish?.name).toBe(KENTISH_DROVERS.name);
  expect(venues.some((venue) => venue.id === kentish?.id)).toBe(false);
  if (!kentish) throw new Error("The Kentish Drovers is not in the historical dataset");
  // Only the listing rows that do not name the operator, and no website.
  const kentishUnlabelled = {
    ...kentish,
    website: "",
    prices: kentish.prices.filter(
      (price) => !/wetherspoon/i.test(`${price.pub_name} ${decoded(price.pub_url)}`),
    ),
  };
  expect(kentishUnlabelled.prices.length).toBeGreaterThan(0);

  return { venues, directoryIds, spoonMeIds, kentishUnlabelled };
}

describe("Tonight's Wetherspoon lane reads the directory join and the SpoonMe pack", () => {
  beforeEach(() => {
    resetVenuePriceIndexForTests();
  });

  it("labels The Kentish Drovers a Wetherspoon on its unlabelled listing rows", async () => {
    const { directoryIds, spoonMeIds, kentishUnlabelled } = await tonightInputs();
    const wetherspoonIds = tonightWetherspoonVenueIds(directoryIds, spoonMeIds);
    expect(tonightCheapPintChain(kentishUnlabelled, wetherspoonIds)).toBe("wetherspoon");
  });

  it("excludes the closed pub and caps the other pack pubs under one Wetherspoon row", async () => {
    const { venues, directoryIds, spoonMeIds, kentishUnlabelled } = await tonightInputs();
    const wetherspoonIds = tonightWetherspoonVenueIds(directoryIds, spoonMeIds);

    const candidates = venues.map((venue) => {
      const source = venue.id === kentishUnlabelled.id ? kentishUnlabelled : venue;
      return {
        id: source.id,
        name: source.name,
        primaryBorough: source.primaryBorough,
        cheapestPrice: source.cheapestPrice,
        chain: tonightCheapPintChain(source, wetherspoonIds),
      };
    });
    for (const candidate of candidates) {
      if (spoonMeIds.has(candidate.id)) expect(candidate.chain).toBe("wetherspoon");
    }

    const shown = tonightCheapPints(candidates, candidates.length);
    expect(shown.filter((row) => row.chain === "wetherspoon")).toHaveLength(1);
    const kentishRow = shown.find((row) => row.venueId === kentishUnlabelled.id);
    expect(kentishRow).toBeUndefined();
    expect(tonightCheapPints([{ id: kentishUnlabelled.id, name: kentishUnlabelled.name, primaryBorough: kentishUnlabelled.primaryBorough, cheapestPrice: 2.43, chain: "wetherspoon" }])).toEqual([]);
    for (const row of shown) {
      if (row.chain === null) {
        expect(spoonMeIds.has(row.venueId)).toBe(false);
        expect(directoryIds.has(row.venueId)).toBe(false);
      }
    }
  });

  it("never labels a pub that is in neither source", async () => {
    const { directoryIds, spoonMeIds } = await tonightInputs();
    const wetherspoonIds = tonightWetherspoonVenueIds(directoryIds, spoonMeIds);
    const neither = {
      id: "venue-in-neither-source",
      website: "",
      prices: [{ pub_name: "The Local", pub_url: "", website: "" }],
    };
    expect(wetherspoonIds.has(neither.id)).toBe(false);
    expect(tonightCheapPintChain(neither, wetherspoonIds)).toBeNull();
    // The union adds nothing beyond its two sources.
    for (const id of wetherspoonIds) {
      expect(directoryIds.has(id) || spoonMeIds.has(id)).toBe(true);
    }
  });
});
