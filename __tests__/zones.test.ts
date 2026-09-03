import { describe, expect, it } from "vitest";

import {
  MIN_PRICED_VENUES,
  computeZonePintIndex,
  median,
  parseZoneParam,
  toZoneId,
  venueMatchesZone,
  zoneLabel,
  zoneOrderSurpriseLine,
  type ZonePintIndex,
  type ZonePricedVenue,
} from "@/lib/zones";

describe("median", () => {
  it("returns the middle value for odd counts", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values for even counts", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("ignores non-finite values", () => {
    expect(median([Number.NaN, 4, 2, Number.POSITIVE_INFINITY])).toBe(3);
  });

  it("returns null for an empty list", () => {
    expect(median([])).toBeNull();
  });
});

describe("toZoneId / parseZoneParam", () => {
  it("accepts 1–6 and rejects out-of-range / junk", () => {
    expect(toZoneId(3)).toBe(3);
    expect(toZoneId("6")).toBe(6);
    expect(toZoneId(0)).toBeNull();
    expect(toZoneId(7)).toBeNull();
    expect(toZoneId(2.5)).toBeNull();
    expect(toZoneId("x")).toBeNull();
  });

  it("parses 'all' and blank as their own selections", () => {
    expect(parseZoneParam("all")).toBe("all");
    expect(parseZoneParam("")).toBeNull();
    expect(parseZoneParam(null)).toBeNull();
    expect(parseZoneParam("4")).toBe(4);
    expect(parseZoneParam("nope")).toBeNull();
  });
});

describe("venueMatchesZone", () => {
  it("passes everything for all / blank / null selection", () => {
    expect(venueMatchesZone(3, "all")).toBe(true);
    expect(venueMatchesZone(3, "")).toBe(true);
    expect(venueMatchesZone(null, "all")).toBe(true);
    expect(venueMatchesZone(undefined, null)).toBe(true);
  });

  it("matches only the exact zone for a concrete selection", () => {
    expect(venueMatchesZone(3, 3)).toBe(true);
    expect(venueMatchesZone(2, 3)).toBe(false);
  });

  it("never matches an unknown-zone venue against a concrete zone", () => {
    expect(venueMatchesZone(null, 3)).toBe(false);
    expect(venueMatchesZone(undefined, 1)).toBe(false);
  });
});

describe("zoneLabel", () => {
  it("labels concrete zones and the all case", () => {
    expect(zoneLabel(2)).toBe("Zone 2");
    expect(zoneLabel("all")).toBe("All zones");
  });
});

describe("computeZonePintIndex", () => {
  // Build a zone with n priced venues at a given price plus optional extras.
  function pricedVenues(zone: number, prices: number[]): ZonePricedVenue[] {
    return prices.map((cheapestPrice) => ({ zone, cheapestPrice }));
  }

  it("gates a zone with fewer than MIN_PRICED_VENUES priced venues", () => {
    const venues = pricedVenues(1, [6, 6.2, 6.4]); // only 3 < 10
    const index = computeZonePintIndex(venues);
    const zone1 = index.rows.find((r) => r.zone === 1)!;
    expect(zone1.pricedCount).toBe(3);
    expect(zone1.enough).toBe(false);
    expect(zone1.medianGbp).toBeNull();
    expect(index.ranked).toHaveLength(0);
    expect(index.taxGbp).toBeNull();
  });

  it("publishes a median once a zone clears the gate", () => {
    const prices = Array.from({ length: MIN_PRICED_VENUES }, (_, i) => 6 + i * 0.1);
    const index = computeZonePintIndex(pricedVenues(2, prices));
    const zone2 = index.rows.find((r) => r.zone === 2)!;
    expect(zone2.enough).toBe(true);
    expect(zone2.pricedCount).toBe(MIN_PRICED_VENUES);
    expect(zone2.medianGbp).not.toBeNull();
  });

  it("computes the zone tax between the dearest and cheapest publishable zones", () => {
    // Zone 1: median 7.00; Zone 3: median 5.00 → tax 2.00.
    const zone1 = pricedVenues(1, Array.from({ length: 10 }, () => 7));
    const zone3 = pricedVenues(3, Array.from({ length: 10 }, () => 5));
    const index = computeZonePintIndex([...zone1, ...zone3]);
    expect(index.dearest?.zone).toBe(1);
    expect(index.cheapest?.zone).toBe(3);
    expect(index.taxGbp).toBe(2);
    // ranked is cheapest → dearest.
    expect(index.ranked.map((r) => r.zone)).toEqual([3, 1]);
  });

  it("excludes venues with no price or an unknown/out-of-range zone", () => {
    const venues: ZonePricedVenue[] = [
      ...pricedVenues(1, Array.from({ length: 10 }, () => 6)),
      { zone: 1, cheapestPrice: null }, // no price → not counted
      { zone: null, cheapestPrice: 6 }, // unknown zone → dropped
      { zone: 9, cheapestPrice: 6 }, // outside 1–6 filter set → dropped
    ];
    const index = computeZonePintIndex(venues);
    const zone1 = index.rows.find((r) => r.zone === 1)!;
    expect(zone1.pricedCount).toBe(10);
  });

  it("excludes non-pub anchors from pint medians", () => {
    const pubs = pricedVenues(1, Array.from({ length: 10 }, () => 6));
    const index = computeZonePintIndex([
      ...pubs,
      { zone: 1, cheapestPrice: 25, kind: "bar" },
      { zone: 1, cheapestPrice: 12, kind: "food" },
    ]);
    const zone1 = index.rows.find((row) => row.zone === 1)!;
    expect(zone1.pricedCount).toBe(10);
    expect(zone1.medianGbp).toBe(6);
  });

  it("always returns exactly the six filterable zones in order", () => {
    const index = computeZonePintIndex([]);
    expect(index.rows.map((r) => r.zone)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(index.rows.every((r) => r.pricedCount === 0 && !r.enough)).toBe(true);
  });
});

describe("zoneOrderSurpriseLine", () => {
  // The figures read off https://pubmaxxing.com/pint-index on 30 August 2026.
  // Zone 6 sits 10p above Zone 5 on the two thinnest samples in the index, and
  // the page said nothing about it, which the audit filed as slop.
  const liveRows = [
    { zone: 1, pricedCount: 357, enough: true, medianGbp: 6.2 },
    { zone: 2, pricedCount: 298, enough: true, medianGbp: 5.7 },
    { zone: 3, pricedCount: 131, enough: true, medianGbp: 5.3 },
    { zone: 4, pricedCount: 65, enough: true, medianGbp: 4.9 },
    { zone: 5, pricedCount: 51, enough: true, medianGbp: 4.6 },
    { zone: 6, pricedCount: 45, enough: true, medianGbp: 4.7 },
  ];

  const index = (rows: typeof liveRows): ZonePintIndex =>
    ({ rows, ranked: [], dearest: null, cheapest: null, taxGbp: null }) as unknown as ZonePintIndex;

  it("explains the live inversion with the two counts behind it", () => {
    expect(zoneOrderSurpriseLine(index(liveRows))).toBe(
      "Zone 6 reads dearer than Zone 5. They are the thinnest samples here: 45 and 51 priced pubs.",
    );
  });

  it("says nothing when the ladder falls outwards as expected", () => {
    const ordered = liveRows.map((row) =>
      row.zone === 6 ? { ...row, medianGbp: 4.4 } : row,
    );
    expect(zoneOrderSurpriseLine(index(ordered))).toBeNull();
  });

  it("says nothing when the inversion is not on the thin end", () => {
    // Zone 2 dearer than Zone 1, both very well sampled. "Small sample" would
    // be an excuse rather than a reading, so we owe the reader silence.
    const wellSampled = liveRows.map((row) =>
      row.zone === 2
        ? { ...row, medianGbp: 6.5 }
        : row.zone === 6
          ? { ...row, medianGbp: 4.4 }
          : row,
    );
    expect(zoneOrderSurpriseLine(index(wellSampled))).toBeNull();
  });

  it("continues past a non-thin inversion to a later thin one", () => {
    const laterThinInversion = [
      { zone: 1, pricedCount: 100, enough: true, medianGbp: 4 },
      { zone: 2, pricedCount: 100, enough: true, medianGbp: 5 },
      { zone: 3, pricedCount: 10, enough: true, medianGbp: 4 },
      { zone: 4, pricedCount: 10, enough: true, medianGbp: 6 },
    ];
    expect(zoneOrderSurpriseLine(index(laterThinInversion))).toBe(
      "Zone 4 reads dearer than Zone 3. They are the thinnest samples here: 10 and 10 priced pubs.",
    );
  });

  it("claims no confidence, no interval and no probability", () => {
    const line = zoneOrderSurpriseLine(index(liveRows)) ?? "";
    expect(line).not.toMatch(/probab|confidence|margin|significan|likely/i);
  });

  it("says nothing when too few zones are publishable to see an order at all", () => {
    expect(zoneOrderSurpriseLine(index(liveRows.slice(4)))).toBeNull();
  });
});
