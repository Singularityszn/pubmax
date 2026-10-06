// A Wetherspoon the directory dropped is still a Wetherspoon on /tonight.
//
// `tonightCheapPints` keeps one row per chain. Chain membership for the
// Wetherspoon lane came from the first-party directory join, backed by the
// pub's website host and a price listing that names the operator. The
// directory refresh of 14 Sep 2026 rebuilt the directory from the chain's own
// listing, and that listing no longer carries The Kentish Drovers (SE15 5RS),
// although the pub still trades as a Wetherspoon: SpoonMe read its menu off the
// chain's own site, and Dulwich Today (31 Aug 2026) reports it trading.
//
// Today half of that pub's listing rows name "JD Wetherspoon" and half do not,
// so the label is all that keeps its GBP 1.99 off Tonight as an uncapped free
// house. A re-import that keeps only the unlabelled rows would lose it. So
// membership reads two first-party-derived sources: the directory join and the
// SpoonMe pack (public/data/spoonme/rows.json). A pub in either is a
// Wetherspoon for the cap and the label. A pub in neither is not.
//
// This fence joins the REAL directory, the REAL pack and the REAL priced index
// the Tonight page reads, and strips the listing label off the pub, so it holds
// on the two membership sources alone.

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
  const kentish = venues.find((venue) => venue.id === defined(kentishPackRows[0]).venueId);
  expect(kentish?.name).toBe(KENTISH_DROVERS.name);
  if (!kentish) throw new Error("The Kentish Drovers is not in the priced index");
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

  it("caps The Kentish Drovers and every other pack pub under the one Wetherspoon row", async () => {
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
    if (kentishRow) expect(kentishRow.chain).toBe("wetherspoon");
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
