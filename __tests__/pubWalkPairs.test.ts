import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { haversineMeters } from "@/lib/greatCircle.mjs";
import { parsePubWalkPairs, pubStreetWalkKm } from "@/lib/pubWalkPairs.server";

const ROOT = path.resolve(__dirname, "..");
const raw = JSON.parse(readFileSync(path.join(ROOT, "data", "pub_walk_pairs.json"), "utf8"));
const venues = new Map<string, { lat: number; lng: number }>(
  (JSON.parse(readFileSync(path.join(ROOT, "public", "data", "venues_slim.json"), "utf8")).rows as {
    id: string;
    lat: number;
    lng: number;
  }[]).map((row) => [row.id, row]),
);

const FIXTURE = parsePubWalkPairs({ venueIds: ["a", "b", "c"], pairs: { "0": [[1, 1250], [2, 400]] } });

describe("pubStreetWalkKm", () => {
  it("answers a pair in either order", () => {
    expect(pubStreetWalkKm("a", "b", FIXTURE)).toBe(1.25);
    expect(pubStreetWalkKm("b", "a", FIXTURE)).toBe(1.25);
  });

  it("returns null for a pair the table does not hold, and for a pub to itself", () => {
    expect(pubStreetWalkKm("b", "c", FIXTURE)).toBeNull();
    expect(pubStreetWalkKm("a", "zz", FIXTURE)).toBeNull();
    expect(pubStreetWalkKm("a", "a", FIXTURE)).toBeNull();
  });

  it("drops malformed rows rather than throwing", () => {
    const parsed = parsePubWalkPairs({
      venueIds: ["a", "b"],
      pairs: { "0": [[1, -1], [9, 10], [1, "x"], "nope"], "7": [[0, 5]] },
    });
    expect(parsed.size).toBe(0);
    expect(parsePubWalkPairs(null).size).toBe(0);
  });
});

describe("data/pub_walk_pairs.json", () => {
  const ids = raw.venueIds as string[];

  it("names its source, licence and builder", () => {
    expect(raw._provenance).toEqual(
      expect.objectContaining({
        source: expect.stringContaining("Overture"),
        licence: expect.stringContaining("OpenStreetMap"),
        builder: "scripts/build_station_walk_access.py",
      }),
    );
  });

  it("holds tens of thousands of pairs between curated pubs in the venue index", () => {
    expect(parsePubWalkPairs(raw).size).toBeGreaterThan(30_000);
    const missing = ids.filter((id) => !venues.has(id));
    expect(missing).toEqual([]);
  });

  it("never holds a walk shorter than the straight line, nor a pair past the straight-line cap", () => {
    for (const [fromIndex, row] of Object.entries(raw.pairs as Record<string, [number, number][]>)) {
      const from = venues.get(ids[Number(fromIndex)]!)!;
      for (const [toIndex, metres] of row) {
        expect(toIndex).toBeGreaterThan(Number(fromIndex));
        const to = venues.get(ids[toIndex]!)!;
        const straight = haversineMeters(from.lat, from.lng, to.lat, to.lng);
        expect(straight).toBeLessThanOrEqual(raw.maxStraightMetres + 1);
        expect(metres + 1).toBeGreaterThanOrEqual(straight);
      }
    }
  });
});
