// THE MAP'S SOFT-DRINK LENS FINDS WHAT /soft-drinks-and-water LISTS. That page
// reads the UK price bundle's listed site-harvest rows; the map reads the slim
// index's filterHints. scripts/build_slim_index.mjs copies each venue's listed
// soft-drink subtypes into filterHints.drinkSubtypes, so "Open the map" shows
// the pubs the list just named. This holds the committed files to each other.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type SlimRow = { id: string; filterHints?: { drinkSubtypes?: string[] } };
type BundleRow = {
  venueId: string;
  lane: string;
  standing: string;
  category: string;
  drinkSubtype?: string | null;
};

const slim = (JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")) as { rows: SlimRow[] }).rows;
const bundle = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")) as
  | BundleRow[]
  | { rows: BundleRow[] };
const bundleRows = Array.isArray(bundle) ? bundle : bundle.rows;
const slimById = new Map(slim.map((row) => [row.id, row]));

function listedSoftDrinkSubtypes(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const row of bundleRows) {
    if (row.lane !== "site-harvest" || row.standing !== "listed" || row.category !== "soft-drink") continue;
    if (typeof row.drinkSubtype !== "string") continue;
    const held = out.get(row.venueId) ?? new Set<string>();
    held.add(row.drinkSubtype);
    out.set(row.venueId, held);
  }
  return out;
}

describe("slim soft-drink subtype hints", () => {
  const expected = listedSoftDrinkSubtypes();

  it("hints every listed soft-drink subtype on the curated venue that publishes it", () => {
    const curated = [...expected].filter(([venueId]) => slimById.has(venueId));
    expect(curated.length).toBeGreaterThan(0);
    for (const [venueId, subtypes] of curated) {
      expect(slimById.get(venueId)?.filterHints?.drinkSubtypes, venueId).toEqual([...subtypes].sort());
    }
  });

  it("hints nothing the bundle does not list", () => {
    for (const row of slim) {
      const hinted = row.filterHints?.drinkSubtypes;
      if (!hinted) continue;
      expect([...(expected.get(row.id) ?? [])].sort(), row.id).toEqual(hinted);
    }
  });
});
