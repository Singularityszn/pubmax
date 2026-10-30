import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isLastOrdersHour,
  lastOrdersCountdownLabel,
  lastOrdersMapRequested,
  lastOrdersOpenVenueIds,
  parseLastOrdersHoursPack,
  parseLastOrdersPricesPack,
  rankLastOrders,
  type LastOrdersPub,
} from "@/lib/lastOrdersList";
import { buildLastOrdersPacks } from "@/scripts/build_last_orders_pack.mjs";

const FRIDAY_2245 = new Date("2026-10-30T22:45:00Z");
const FROM = { lat: 51.5145, lng: -0.1313 }; // Soho

function pub(venueId: string, openingHours: string, metresNorth: number): LastOrdersPub {
  return {
    venueId,
    name: venueId,
    lat: FROM.lat + metresNorth / 111_320,
    lng: FROM.lng,
    openingHours,
    hoursCheckDate: null,
  };
}

describe("rankLastOrders", () => {
  const pubs = [
    pub("venue-late-dear", "Mo-Su 12:00-01:00", 150),
    pub("venue-late-cheap", "Mo-Su 12:00-01:00", 200),
    pub("venue-closes-soon", "Mo-Su 12:00-23:10", 50),
    pub("venue-closed", "Mo-Su 12:00-22:00", 50),
    pub("venue-unknown", "Mo-Su 12:00-23:30; Dec 25 off", 50),
    pub("venue-far", "Mo-Su 12:00-02:00", 4_000),
    pub("venue-walk-too-long", "Mo-Su 12:00-23:20", 1_900),
    pub("venue-all-night", "24/7", 900),
  ];
  const prices = new Map([
    ["venue-late-dear", { priceGbp: 7.2, observedAt: "2026-10-02" }],
    ["venue-late-cheap", { priceGbp: 5.1, observedAt: "2026-10-02" }],
  ]);
  const rows = rankLastOrders({ pubs, prices, from: FROM, now: FRIDAY_2245 });

  it("lists only pubs whose sourced hours run at least 30 more minutes", () => {
    const ids = rows.map((row) => row.venueId);
    expect(ids).not.toContain("venue-closes-soon");
    expect(ids).not.toContain("venue-closed");
    expect(ids).not.toContain("venue-unknown");
  });

  it("leaves off a pub too far to walk to, or one that would close on arrival", () => {
    const ids = rows.map((row) => row.venueId);
    expect(ids).not.toContain("venue-far");
    // 35 minutes left, but a 23-minute walk leaves less than a quarter of an hour.
    expect(ids).not.toContain("venue-walk-too-long");
  });

  it("puts the cheaper pint first at the same walk, and carries the countdown", () => {
    expect(rows.map((row) => row.venueId)).toEqual(["venue-late-cheap", "venue-late-dear", "venue-all-night"]);
    expect(rows[0]).toMatchObject({ minutesLeft: 135, closesAt: "01:00" });
    expect(rows[0]?.walkMinutes).toBeLessThanOrEqual(3);
    expect(rows[2]).toMatchObject({ minutesLeft: null, closesAt: null, price: null });
  });
});

describe("lastOrdersOpenVenueIds", () => {
  it("keeps only pubs open 30 more minutes or all night, however far away", () => {
    const ids = lastOrdersOpenVenueIds(
      [
        pub("venue-late", "Mo-Su 12:00-01:00", 0),
        pub("venue-far-late", "Mo-Su 12:00-02:00", 40_000),
        pub("venue-soon", "Mo-Su 12:00-23:10", 0),
        pub("venue-closed", "Mo-Su 12:00-22:00", 0),
        pub("venue-unknown", "Mo-Su 12:00-23:30; Dec 25 off", 0),
        pub("venue-all-night", "24/7", 0),
      ],
      FRIDAY_2245,
    );
    expect([...ids].sort()).toEqual(["venue-all-night", "venue-far-late", "venue-late"]);
  });

  it("reads the map address that turns it on", () => {
    expect(lastOrdersMapRequested("?lastOrders=1")).toBe(true);
    expect(lastOrdersMapRequested("?sel=venue-a&lastOrders=1")).toBe(true);
    expect(lastOrdersMapRequested("?lastOrders=0")).toBe(false);
    expect(lastOrdersMapRequested("")).toBe(false);
  });
});

describe("lastOrdersCountdownLabel", () => {
  it("reads minutes inside two hours, the close past that, and all night for 24/7", () => {
    expect(lastOrdersCountdownLabel({ minutesLeft: 41, closesAt: "23:30" })).toBe("Open 41 more min");
    expect(lastOrdersCountdownLabel({ minutesLeft: 135, closesAt: "01:00" })).toBe("Open until 01:00");
    expect(lastOrdersCountdownLabel({ minutesLeft: null, closesAt: null })).toBe("Open all night");
  });
});

describe("isLastOrdersHour", () => {
  it("is the London late window, 21:30 to 03:59", () => {
    expect(isLastOrdersHour(new Date("2026-10-30T21:29:00Z"))).toBe(false);
    expect(isLastOrdersHour(new Date("2026-10-30T21:30:00Z"))).toBe(true);
    expect(isLastOrdersHour(FRIDAY_2245)).toBe(true);
    expect(isLastOrdersHour(new Date("2026-10-31T03:59:00Z"))).toBe(true);
    expect(isLastOrdersHour(new Date("2026-10-31T04:00:00Z"))).toBe(false);
    // BST: 20:30 UTC on 31 August is 21:30 in London.
    expect(isLastOrdersHour(new Date("2026-08-31T20:30:00Z"))).toBe(true);
  });
});

describe("the packs", () => {
  const read = (file: string) =>
    JSON.parse(readFileSync(path.join(process.cwd(), "public", "data", "last_orders", file), "utf8"));

  it("parse, and drop a malformed row rather than guess at it", () => {
    const parsed = parseLastOrdersHoursPack({
      version: 1,
      readOn: "2026-10-05",
      rows: [
        ["venue-a", "A", 51.5, -0.1, "Mo-Su 12:00-23:00", "2025-04"],
        ["venue-b", "B", "51.5", -0.1, "Mo-Su 12:00-23:00", ""],
        ["venue-c", "C", 51.5, -0.1, "", ""],
      ],
    });
    expect(parsed?.pubs.map((row) => row.venueId)).toEqual(["venue-a"]);
    expect(parsed?.pubs[0]?.hoursCheckDate).toBe("2025-04");
    expect(parseLastOrdersHoursPack({ version: 2, rows: [] })).toBeNull();
    expect(parseLastOrdersPricesPack({ version: 1, rows: { "venue-a": [5.5, "2026-10-02"], "venue-b": [0, ""] } }))
      .toEqual(new Map([["venue-a", { priceGbp: 5.5, observedAt: "2026-10-02" }]]));
  });

  it("are what the builder makes from the committed sources", () => {
    const json = (...parts: string[]) => JSON.parse(readFileSync(path.join(process.cwd(), ...parts), "utf8"));
    const slim = json("public", "data", "venues_slim.json");
    const built = buildLastOrdersPacks({
      facts: json("data", "osm", "facts", "london_pub_facts.json"),
      pubs: json("data", "osm", "uk", "uk_osm_pubs.json").pubs,
      slimRows: Array.isArray(slim) ? slim : slim.rows,
      closed: json("data", "places_verification", "closed_pubs.json"),
    });
    expect(read("london_hours.json")).toEqual(built.hours);
    expect(read("london_prices.json")).toEqual(built.prices);
  });

  it("keeps the OSM pack OSM's alone and credits it", () => {
    const hours = read("london_hours.json");
    expect(hours).toMatchObject({ license: "ODbL 1.0", source: "OpenStreetMap" });
    const prices = read("london_prices.json");
    expect(prices.license).toBeUndefined();
    for (const row of hours.rows) expect(row).toHaveLength(6);
  });

  it("drops a pub with no hours and a pub verified closed", () => {
    const built = buildLastOrdersPacks({
      facts: {
        extractedAt: "2026-10-05T22:52:59Z",
        rows: [
          { osmId: "node/1", openingHours: "Mo-Su 12:00-23:00" },
          { osmId: "node/2" },
          { osmId: "node/3", openingHours: "Mo-Su 12:00-23:00" },
          { osmId: "way/4", openingHours: "Mo-Su 12:00-01:00" },
        ],
      },
      pubs: [
        { osmId: "node/1", name: "One", lat: 51.5, lng: -0.1 },
        { osmId: "node/2", name: "Two", lat: 51.5, lng: -0.1 },
        { osmId: "node/3", name: "Three", lat: 51.5, lng: -0.1 },
        { osmId: "way/4", name: "Four", lat: 51.5, lng: -0.1, curatedRef: { source: "curated-london-slim", id: "venue-four" } },
      ],
      slimRows: [{ id: "venue-four", cheapestPrice: 5.2, priceObservedAt: "2026-10-02" }],
      closed: { osmRefs: ["n3"] },
    });
    expect(built.hours.rows.map((row: unknown[]) => row[0])).toEqual(["venue-four", "venue-osm-n1"]);
    expect(built.hours.readOn).toBe("2026-10-05");
    expect(built.prices.rows).toEqual({ "venue-four": [5.2, "2026-10-02"] });
  });
});
