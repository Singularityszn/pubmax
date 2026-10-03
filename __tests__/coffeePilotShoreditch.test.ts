// The Shoreditch coffee file is a hand-checked list. A row is one named drink
// a page stated. The map, the pint bundle and the freshness registry do not
// read it.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import registry from "@/data/freshness_registry.json";
import {
  COFFEE_PILOT_FILE,
  coffeePilotProblems,
  shoreditchCafeIds,
} from "../scripts/lib/coffeePilotRows.mjs";

const ROOT = resolve(__dirname, "..");
const FILE = join(ROOT, COFFEE_PILOT_FILE);

function listedRow(venueId: string, overrides: Record<string, unknown> = {}) {
  return {
    venueId,
    venueName: "Example Cafe",
    drink: "flat white",
    priceGbp: 3.4,
    sourceUrl: "https://example.test/menu",
    observedAt: "2026-10-03",
    standing: "listed",
    quote: "Flat white £3.40",
    ...overrides,
  };
}

describe("Shoreditch coffee pilot", () => {
  const file = JSON.parse(readFileSync(FILE, "utf8")) as {
    rows: unknown[];
    drinks: string[];
  };
  const venueIds = shoreditchCafeIds(ROOT);
  const sampleId = [...venueIds][0];

  it("holds only listed rows for the three named drinks", () => {
    expect(coffeePilotProblems(file, venueIds, Date.parse("2026-10-03T18:00:00Z"))).toEqual([]);
    expect(file.drinks).toEqual(["flat white", "latte", "matcha latte"]);
    expect(file.rows).toEqual([]);
    expect(venueIds.size).toBeGreaterThan(0);
  });

  it("refuses a blank coffee price, an estimate, and a cheapest figure", () => {
    const now = Date.parse("2026-10-03T18:00:00Z");
    const base = { ...file, rows: [listedRow(sampleId)] };
    expect(coffeePilotProblems(base, venueIds, now)).toEqual([]);
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { drink: "coffee", quote: "Coffee £3.40" })],
    }, venueIds, now).join("\n")).toContain("three named drinks");
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { standing: "estimate" })],
    }, venueIds, now).join("\n")).toContain("standing must be listed");
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { cheapestPrice: 3.4 })],
    }, venueIds, now).join("\n")).toContain("cheapestPrice");
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { drink: "latte", quote: "Latte art £3.40" })],
    }, venueIds, now).join("\n")).toContain("does not name latte");
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { drink: "latte", quote: "Matcha latte £4.20", priceGbp: 4.2 })],
    }, venueIds, now).join("\n")).toContain("does not name latte");
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { venueId: "venue-osm-n1" })],
    }, venueIds, now).join("\n")).toContain("not a cafe in the Shoreditch box");
  });

  it("is not a freshness feed", () => {
    const datasets = (registry as { datasets: { artifact?: string }[] }).datasets;
    expect(datasets.some((dataset) => dataset.artifact === COFFEE_PILOT_FILE)).toBe(false);
    expect(COFFEE_PILOT_FILE.startsWith("public/")).toBe(false);
  });
});
