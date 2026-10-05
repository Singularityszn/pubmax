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
  shoreditchCafeNames,
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
    ...overrides,
  };
}

describe("Shoreditch coffee pilot", () => {
  const file = JSON.parse(readFileSync(FILE, "utf8")) as {
    rows: unknown[];
  };
  const venueIds = shoreditchCafeIds(ROOT);
  const venueNames = shoreditchCafeNames(ROOT);
  const sampleId = [...venueIds][0];

  it("holds only listed rows for the three named drinks", () => {
    expect(coffeePilotProblems(file, venueIds, Date.parse("2026-10-03T18:00:00Z"), venueNames)).toEqual([]);
    expect(file.rows.length).toBeGreaterThan(0);
    expect(venueIds.size).toBeGreaterThan(0);
  });

  it("refuses a blank coffee price, an estimate, and a cheapest figure", () => {
    const now = Date.parse("2026-10-03T18:00:00Z");
    const base = { ...file, rows: [listedRow(sampleId)] };
    expect(coffeePilotProblems(base, venueIds, now)).toEqual([]);
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { drink: "coffee" })],
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
      rows: [listedRow(sampleId, { venueId: "venue-osm-n1" })],
    }, venueIds, now).join("\n")).toContain("not a cafe in the Shoreditch box");
    const names = new Map([[sampleId, "Real Cafe"]]);
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { venueName: "Real Cafe" })],
    }, venueIds, now, names)).toEqual([]);
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { venueName: "Other Cafe" })],
    }, venueIds, now, names).join("\n")).toContain("does not match the cafe");
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { observedAt: "2026-02-30" })],
    }, venueIds, now).join("\n")).toContain("calendar day");
    expect(coffeePilotProblems({
      ...base,
      rows: [listedRow(sampleId, { observedAt: "2026-10-03T18:00:00Z" })],
    }, venueIds, now).join("\n")).toContain("calendar day");
  });

  it("names the new id when OSM re-keys a cafe in the box", () => {
    const now = Date.parse("2026-10-03T18:00:00Z");
    const layer = new Map([
      ["venue-osm-w373262267", "Gecko Coffeehouse"],
      ["venue-osm-n4959842421", "Holy Shot"],
    ]);
    const ids = new Set(layer.keys());
    const rekeyed = coffeePilotProblems({
      ...file,
      rows: [listedRow("venue-osm-n13684996801", { venueName: "Gecko Coffeehouse" })],
    }, ids, now, layer);
    expect(rekeyed).toEqual([
      "rows[0] venueId is not a cafe in the Shoreditch box: Gecko Coffeehouse is now venue-osm-w373262267",
    ]);
    const gone = coffeePilotProblems({
      ...file,
      rows: [listedRow("venue-osm-n13684996801", { venueName: "Closed Cafe" })],
    }, ids, now, layer);
    expect(gone).toEqual(["rows[0] venueId is not a cafe in the Shoreditch box"]);
  });

  it("is not a freshness feed", () => {
    const datasets = (registry as { datasets: { artifact?: string }[] }).datasets;
    expect(datasets.some((dataset) => dataset.artifact === COFFEE_PILOT_FILE)).toBe(false);
    expect(COFFEE_PILOT_FILE.startsWith("public/")).toBe(false);
  });
});
