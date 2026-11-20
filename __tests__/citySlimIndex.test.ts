import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { comparablePint } from "@/lib/comparablePint.mjs";
import { validateCityPackRow, validateCityVenuePacks } from "@/scripts/validate-data.mjs";

const ROOT = path.resolve(__dirname, "..");
const SLIM_PATH = path.join(ROOT, "public", "data", "cities", "manchester", "venues_slim.json");

const MANCHESTER_BBOX = {
  south: 53.38,
  west: -2.35,
  north: 53.55,
  east: -2.1,
};

type SlimRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  borough: string;
  filterHints?: { searchText?: string };
};

describe("manchester city slim index", () => {
  it("exists as a built artifact", () => {
    expect(existsSync(SLIM_PATH)).toBe(true);
  });

  it("has >100 venues with unique city-prefixed ids, in-bounds coords and sourced prices", () => {
    const payload = JSON.parse(readFileSync(SLIM_PATH, "utf8")) as { rows?: SlimRow[] };
    const rows = payload.rows ?? [];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(100);

    const ids = new Set<string>();
    for (const row of rows) {
      expect(typeof row.id).toBe("string");
      expect(row.id.startsWith("venue-mcr-")).toBe(true);
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);

      expect(typeof row.name).toBe("string");
      expect(row.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(row.lat)).toBe(true);
      expect(Number.isFinite(row.lng)).toBe(true);
      expect(row.lat).toBeGreaterThanOrEqual(MANCHESTER_BBOX.south);
      expect(row.lat).toBeLessThanOrEqual(MANCHESTER_BBOX.north);
      expect(row.lng).toBeGreaterThanOrEqual(MANCHESTER_BBOX.west);
      expect(row.lng).toBeLessThanOrEqual(MANCHESTER_BBOX.east);

      if (row.cheapestPrice !== null) {
        expect(comparablePint(row)).toBe(row.cheapestPrice);
      }
      expect(row.borough).toBe("Manchester");
      expect(typeof row.filterHints?.searchText).toBe("string");
      expect(row.filterHints!.searchText!.length).toBeGreaterThan(0);
    }
    expect(ids.size).toBe(rows.length);
  });

  it("publishes the reviewed Ford Madox Brown price from B3", () => {
    const payload = JSON.parse(readFileSync(SLIM_PATH, "utf8")) as { rows: SlimRow[] };
    expect(payload.rows.find((row) => row.id === "venue-mcr-h1zk6u")).toMatchObject({
      cheapestPrice: 3.5,
      cheapestPint: "Guinness",
      measure: "pint",
      priceSource: "Guinndex",
      priceObservedAt: "2026-04-12",
    });
  });

  it("accepts the eleven published canonical packs and their matching core shards", () => {
    expect(validateCityVenuePacks().ok).toBe(true);
  });

  const pricedPub = {
    id: "venue-mcr-h1zk6u", name: "The Ford Madox Brown",
    lat: 53.4582074, lng: -2.2266611, borough: "Manchester",
    cheapestPrice: 3.5, cheapestPint: "Guinness", measure: "pint",
    priceSource: "Guinndex", priceObservedAt: "2026-04-12",
    filterHints: { searchText: "the ford madox brown manchester" },
  };
  const bounds = { latMin: 53.38, lonMin: -2.35, latMax: 53.55, lonMax: -2.1 };

  it("accepts a sourced pint and an unpriced pub", () => {
    expect(validateCityPackRow("manchester", pricedPub, new Set(), bounds)).toEqual([]);
    expect(validateCityPackRow("manchester", { ...pricedPub, cheapestPrice: null }, new Set(), bounds)).toEqual([]);
  });

  it.each([
    { cheapestPrice: 0 },
    { cheapestPrice: -1 },
    { cheapestPrice: "3.50" },
    { cheapestPrice: undefined },
    { priceSource: "" },
    { priceObservedAt: "2026-02-30" },
    { priceObservedAt: "2999-01-01" },
    { measure: "half-pint" },
    { cheapestPint: "Guinness 330ml bottle" },
    { kind: "restaurant" },
    { kind: "bar" },
  ])("rejects a city price with invalid evidence: %j", (change) => {
    expect(validateCityPackRow("manchester", { ...pricedPub, ...change }, new Set(), bounds)).not.toEqual([]);
  });
});
