import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  stableVenueIdFromKey,
  venueGroupingKey,
  type VenuePrice,
} from "@/lib/venues";
import { SLIM_VENUES_PATH, type SlimVenue } from "@/lib/venuesSlim";

// Guards the built public/data/venues_slim.json — the ~140 KB file the map
// loads instead of the ~6 MB raw dataset (scripts/build_slim_index.mjs). The
// script MIRRORS lib/venues.ts's grouping/id logic in plain JS; the id-match
// test below re-derives ids from the real TS off the raw rows, so any drift
// between the mirror and the canonical logic fails here.

const ROOT = path.resolve(__dirname, "..");
const SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");
const RAW_PATH = path.join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const SLIM_KEYS = ["borough", "cheapestPrice", "id", "lat", "lng", "name"];

const slim = JSON.parse(readFileSync(SLIM_PATH, "utf8")) as unknown;
const rawRows = JSON.parse(readFileSync(RAW_PATH, "utf8")) as VenuePrice[];

// The source dataset is London-*centred* but not London-*bounded*: ~19% of rows
// carry coords well outside Greater London (mis-geocoded entries the raw feed
// already ships and the existing map already renders). So the coordinate test
// asserts SANE, finite lat/lng in valid geographic range — the real thing a
// guard protects against (a NaN, a lat/lng swap, an empty-string coord) — rather
// than a tight London box the raw data provably doesn't satisfy. A separate
// assertion confirms the bulk still cluster around London, so the slim build
// can't have silently mangled the coordinate column.
const VALID_COORDS = { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 };
const LONDON = { lat: 51.5, lng: -0.12 };

function isSlimVenue(value: unknown): value is SlimVenue {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const price = row.cheapestPrice;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.name === "string" &&
    row.name.length > 0 &&
    typeof row.borough === "string" &&
    typeof row.lat === "number" &&
    Number.isFinite(row.lat) &&
    typeof row.lng === "number" &&
    Number.isFinite(row.lng) &&
    (price === null || (typeof price === "number" && Number.isFinite(price)))
  );
}

describe("venues_slim.json", () => {
  it("is the payload URL used by the map loader", () => {
    expect(SLIM_VENUES_PATH).toBe("/data/venues_slim.json");
  });

  it("parses to a non-empty array", () => {
    expect(Array.isArray(slim)).toBe(true);
    expect((slim as unknown[]).length).toBeGreaterThan(0);
  });

  it("contains only the fields the map hydration path consumes", () => {
    const rows = slim as Record<string, unknown>[];
    const badKeySets = rows
      .map((row) => Object.keys(row).sort())
      .filter((keys) => JSON.stringify(keys) !== JSON.stringify(SLIM_KEYS));
    expect(badKeySets).toEqual([]);
  });

  it("every row matches the SlimVenue shape", () => {
    const rows = slim as unknown[];
    const bad = rows.filter((row) => !isSlimVenue(row));
    expect(bad).toEqual([]);
  });

  it("every venue has finite coordinates in valid geographic range", () => {
    const rows = slim as SlimVenue[];
    for (const v of rows) {
      expect(Number.isFinite(v.lat)).toBe(true);
      expect(Number.isFinite(v.lng)).toBe(true);
      expect(v.lat).toBeGreaterThanOrEqual(VALID_COORDS.minLat);
      expect(v.lat).toBeLessThanOrEqual(VALID_COORDS.maxLat);
      expect(v.lng).toBeGreaterThanOrEqual(VALID_COORDS.minLng);
      expect(v.lng).toBeLessThanOrEqual(VALID_COORDS.maxLng);
    }
  });

  it("the bulk of venues cluster around London (coord column not mangled)", () => {
    // Not every row is in London (see note above), but if the build had swapped
    // or corrupted the coordinate column the median would drift off London. A
    // majority within ~0.5° of central London proves the column survived intact.
    const rows = slim as SlimVenue[];
    const nearLondon = rows.filter(
      (v) => Math.abs(v.lat - LONDON.lat) < 0.5 && Math.abs(v.lng - LONDON.lng) < 0.5,
    );
    expect(nearLondon.length).toBeGreaterThan(rows.length * 0.5);
  });

  it("ids are unique", () => {
    const rows = slim as SlimVenue[];
    const ids = new Set(rows.map((v) => v.id));
    expect(ids.size).toBe(rows.length);
  });

  it("cheapestPrice is a positive number or null", () => {
    const rows = slim as SlimVenue[];
    for (const v of rows) {
      if (v.cheapestPrice !== null) {
        expect(v.cheapestPrice).toBeGreaterThan(0);
      }
    }
  });

  it("slim ids equal the canonical stableVenueIdFromKey(venueGroupingKey(...))", () => {
    // Re-derive every id from the RAW rows using the real TS grouping/id logic,
    // then confirm a spread of slim ids (first / middle / last, plus a random
    // sample) each resolves to a raw group. Proves the .mjs mirror stays exact.
    const canonicalIds = new Set(
      rawRows.map((row) => stableVenueIdFromKey(venueGroupingKey(row))),
    );
    // Sanity: the raw rows collapse into the same venue count as the slim file.
    expect(canonicalIds.size).toBe((slim as SlimVenue[]).length);

    const rows = slim as SlimVenue[];
    const sampleIdx = new Set<number>([
      0,
      Math.floor(rows.length / 2),
      rows.length - 1,
    ]);
    for (let i = 0; i < 10; i += 1) {
      sampleIdx.add(Math.floor((rows.length / 10) * i));
    }
    for (const idx of sampleIdx) {
      const v = rows[idx];
      expect(canonicalIds.has(v.id)).toBe(true);
    }

    // And the whole set matches, not just the sample.
    const slimIds = new Set(rows.map((v) => v.id));
    expect(slimIds).toEqual(canonicalIds);
  });

  it("is meaningfully smaller than the raw dataset", () => {
    const slimBytes = statSync(SLIM_PATH).size;
    const rawBytes = statSync(RAW_PATH).size;
    // The whole point of the split: slim must be a small fraction of raw.
    expect(slimBytes).toBeLessThan(rawBytes * 0.2);
    // And comfortably under the ~600 KB budget the map loads on every visit.
    expect(slimBytes).toBeLessThan(600 * 1024);
  });
});
