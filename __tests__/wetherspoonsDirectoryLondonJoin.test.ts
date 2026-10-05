// The Wetherspoon directory is what names a pub as a Wetherspoon on /tonight.
//
// `tonightCheapPints` keeps one row per chain, and a pub is a Wetherspoon there
// when the first-party directory join says so. So the directory must answer for
// the pubs the chain runs TODAY, and for no pub it has sold.
//
// The Millers Well (E6 2JX) and The Coronet (N7 6PA) were reported missing on
// 13 Sep 2026 (lane 7). They are not missing: Wetherspoon sold both in 2023.
// The chain's own directory, read 2026-09-14, lists 827 pubs and neither of
// them; the chain keeps only their pub-histories pages, and the old pub page
// for The Millers Well redirects to the home page. A price the index still
// holds for either is a pre-sale Wetherspoon price, and that is a price
// question, not a directory one. Adding either pub to the directory by hand
// would put a first-party claim in the chain's mouth that the chain no longer
// makes.
//
// This fence joins the REAL directory to the REAL priced index the Tonight page
// reads, so a directory that starts naming a sold pub fails here.

import { beforeEach, describe, expect, it } from "vitest";

import { tonightCheapPintChain } from "@/lib/tonightCheapPints";
import { getPricedVenues, resetVenuePriceIndexForTests } from "@/lib/venuePriceIndex";
import {
  loadWetherspoonsDirectoryPubs,
  matchWetherspoonsDirectoryPub,
  matchedWetherspoonsVenueIds,
} from "@/lib/wetherspoonsMatch.server";
import { defined } from "@/__tests__/helpers/defined";

const SOLD_LONDON_PUBS = [
  { name: "The Millers Well", postcode: "E6 2JX" },
  { name: "The Coronet", postcode: "N7 6PA" },
] as const;

const compactPostcode = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, "").toUpperCase();

describe("the Wetherspoon directory never names a pub the chain has sold", () => {
  beforeEach(() => {
    resetVenuePriceIndexForTests();
  });

  for (const sold of SOLD_LONDON_PUBS) {
    it(`holds no pub at ${sold.postcode}, where ${sold.name} was`, async () => {
      const pubs = await loadWetherspoonsDirectoryPubs();
      expect(
        pubs.filter((pub) => compactPostcode(pub.postcode) === compactPostcode(sold.postcode)),
      ).toEqual([]);
    });

    it(`never labels the priced ${sold.name} at ${sold.postcode} a Wetherspoon`, async () => {
      const [pubs, venues] = await Promise.all([
        loadWetherspoonsDirectoryPubs(),
        getPricedVenues(),
      ]);
      // The index row is found by name AND by the postcode its own address
      // states, so the fence names one row and never a same-named pub elsewhere.
      const rows = venues.filter(
        (venue) =>
          venue.name === sold.name &&
          compactPostcode(venue.address).endsWith(compactPostcode(sold.postcode)),
      );
      expect(rows).toHaveLength(1);
      const [row] = rows;

      expect(
        matchWetherspoonsDirectoryPub({ name: defined(row).name, lat: defined(row).latitude, lng: defined(row).longitude }, pubs),
      ).toBeNull();

      const matchedIds = await matchedWetherspoonsVenueIds(
        venues.map((venue) => ({
          id: venue.id,
          name: venue.name,
          lat: venue.latitude,
          lng: venue.longitude,
        })),
      );
      expect(matchedIds.has(defined(row).id)).toBe(false);
      expect(tonightCheapPintChain(defined(row), matchedIds)).toBeNull();
    });
  }
});
