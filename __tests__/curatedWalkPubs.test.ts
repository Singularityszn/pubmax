import { describe, expect, it } from "vitest";

import { curatedCrawls } from "@/lib/curatedCrawls";
import type { CuratedWalk } from "@/lib/curatedWalk";
import { curatedWalkPubs } from "@/lib/curatedWalkPubs";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import dataset from "../public/data/pint_prices_app_dataset.json";

// At this latitude 0.001 degrees of longitude is about 69 m and 0.001 degrees
// of latitude is about 111 m. The walk is one straight 400 m leg whose line has
// no vertex between its two stops.
const START: [number, number] = [-0.13, 51.51];
const END: [number, number] = [-0.124226, 51.51];

const walk = {
  stops: [
    { id: "start", name: "Start", longitude: START[0], latitude: START[1], source: "", note: "" },
    { id: "end", name: "End", longitude: END[0], latitude: END[1], source: "", note: "" },
  ],
  path: [START, END],
} as unknown as CuratedWalk;

function pub(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Pub ${overrides.id}`,
    kind: "pub",
    latitude: START[1],
    longitude: START[0],
    cheapestPrice: null,
    priceSource: "Pub menu",
    priceObservedAt: "2026-01-01",
    ...overrides,
  } as Venue;
}

describe("pubs on a curated walk", () => {
  it("keeps a pub beside the walking line between two stops and drops one off the walk", () => {
    const midLeg = pub({ id: "mid-leg", longitude: -0.1268, latitude: 51.51045 });
    const offWalk = pub({ id: "off-walk", longitude: -0.1268, latitude: 51.5127 });
    const result = curatedWalkPubs(walk, [midLeg, offWalk]);
    expect(result.total).toBe(1);
    expect(result.byStop.get("end")?.rows.map((row) => row.id)).toEqual(["mid-leg"]);
    expect(result.byStop.get("start")?.rows).toEqual([]);
  });

  it("lists each pub once, under its nearest stop, nearest first", () => {
    const far = pub({ id: "far", longitude: -0.1286 });
    const near = pub({ id: "near", longitude: -0.1298 });
    const atEnd = pub({ id: "at-end", longitude: END[0] });
    const result = curatedWalkPubs(walk, [far, atEnd, near]);
    expect(result.byStop.get("start")?.rows.map((row) => row.id)).toEqual(["near", "far"]);
    expect(result.byStop.get("end")?.rows.map((row) => row.id)).toEqual(["at-end"]);
    expect(result.total).toBe(3);
    const nearRow = result.byStop.get("start")?.rows[0];
    expect(nearRow?.distanceKm).toBeGreaterThan(0.01);
    expect(nearRow?.distanceKm).toBeLessThan(0.02);
  });

  it("leaves out a venue that is not a pub", () => {
    const restaurant = pub({ id: "restaurant", kind: "restaurant" });
    expect(curatedWalkPubs(walk, [restaurant]).total).toBe(0);
  });

  it("prints a recorded price, marks an estimate and never invents a figure", () => {
    const zoneIndex = {
      rows: [{ zone: 1 as const, medianGbp: 6.4, pricedCount: 50, enough: true }],
      ranked: [], dearest: null, cheapest: null, taxGbp: null, computedAt: "2026-11-10T00:00:00Z",
    };
    const priced = pub({ id: "priced", cheapestPrice: 5.4 });
    const estimated = pub({ id: "estimated", longitude: -0.1299, zone: 1, publicPricePresence: "absent", hasRecordedPrice: false });
    const unknown = pub({ id: "unknown", longitude: -0.1298 });
    const rows = curatedWalkPubs(walk, [priced, estimated, unknown], null, zoneIndex).byStop.get("start")!.rows;
    expect(rows.map((row) => [row.id, row.priceLabel])).toEqual([
      ["priced", "£5.40"], ["estimated", "est. £6.40"], ["unknown", "Price TBD"],
    ]);
  });

  it("reads the cheapest pint from recorded prices only", () => {
    const zoneIndex = {
      rows: [{ zone: 1 as const, medianGbp: 3, pricedCount: 50, enough: true }],
      ranked: [], dearest: null, cheapest: null, taxGbp: null, computedAt: "2026-11-10T00:00:00Z",
    };
    const dear = pub({ id: "dear", cheapestPrice: 7 });
    const cheap = pub({ id: "cheap", cheapestPrice: 5.2 });
    const estimated = pub({ id: "estimated", zone: 1, publicPricePresence: "absent", hasRecordedPrice: false });
    const atEnd = pub({ id: "at-end", longitude: END[0], cheapestPrice: 6.1 });
    const result = curatedWalkPubs(walk, [dear, cheap, estimated, atEnd], null, zoneIndex);
    expect(result.cheapestGbp).toBe(5.2);
    expect(result.byStop.get("end")?.cheapestGbp).toBe(6.1);
    expect(curatedWalkPubs(walk, [estimated], null, zoneIndex).cheapestGbp).toBeNull();
  });

  it("prefers a corroborated Pint Drop over the baseline price", () => {
    const dropped = pub({ id: "dropped", cheapestPrice: 6 });
    const signals = new Map([["dropped", { latestContributorPrice: 5.5, latestContributorAt: Date.now() }]]);
    const result = curatedWalkPubs(walk, [dropped], signals);
    expect(result.byStop.get("start")?.rows[0]?.priceLabel).toBe("£5.50");
    expect(result.cheapestGbp).toBe(5.5);
  });

  it("finds pubs along the London Christmas walk in the published dataset", () => {
    const christmas = curatedCrawls.find((crawl) => crawl.id === "london-christmas-walk")!.walk!;
    const result = curatedWalkPubs(christmas, groupVenuePrices(dataset as VenuePrice[]));
    expect(result.total).toBeGreaterThanOrEqual(40);
    expect([...result.byStop.keys()]).toEqual(christmas.stops.map((stop) => stop.id));
    const listed = result.rows.map((row) => row.id);
    expect(new Set(listed).size).toBe(listed.length);
  });
});
