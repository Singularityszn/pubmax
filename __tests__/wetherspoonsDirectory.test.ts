import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  WetherspoonsDirectory,
  WetherspoonsPub,
} from "@/lib/wetherspoonsDirectory";
import { defined } from "@/__tests__/helpers/defined";

// The directory is SCRAPED/observed data. These tests lock the non-negotiable
// invariants: an honest per-pub {source, observedAt} provenance stamp, and
// GeoJSON coordinates that are finite, in [lng, lat] order, and geographically
// sane. If a refresh ever drops provenance or ships a broken pin, this fails.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function load<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf8")) as T;
}

// pubs.json has a single committed home: public/data/wetherspoons/ (the path
// the app fetches at runtime). pubs.geojson is still written to both
// data/wetherspoons/ and public/data/wetherspoons/ by the refresh script, so
// that pair is still checked for byte-identity.
const DIRECTORY_PATHS = ["public/data/wetherspoons/pubs.json"] as const;

const GEOJSON_PATHS = [
  "data/wetherspoons/pubs.geojson",
  "public/data/wetherspoons/pubs.geojson",
] as const;

describe("Wetherspoons directory dataset", () => {
  it("data/ and public/data/ geojson copies are byte-identical", () => {
    const [ga, gb] = GEOJSON_PATHS.map((p) =>
      readFileSync(join(ROOT, p), "utf8"),
    );
    expect(ga).toBe(gb);
  });

  it("holds the 827 pubs the chain's own directory listed on 2026-09-14", () => {
    const dir = load<WetherspoonsDirectory>(DIRECTORY_PATHS[0]);
    expect(dir.pubs).toHaveLength(827);
    expect(dir.count).toBe(dir.pubs.length);
  });

  it("follows the chain's directory: new openings in, sold pubs out", () => {
    const dir = load<WetherspoonsDirectory>(DIRECTORY_PATHS[0]);
    const names = new Set(dir.pubs.map((pub) => `${pub.name}|${pub.postcode}`));
    expect(names.has("The Fletton Brick|MK42 7FY")).toBe(true);
    expect(names.has("Home Farm|HU13 0JA")).toBe(true);
    expect(names.has("Piccadilly Hall|W1D 7EJ")).toBe(true);
    expect(names.has("The Kentish Drovers|SE15 5RS")).toBe(false);
    expect(names.has("The Ernehale|NG5 6JN")).toBe(false);
  });

  it("reads names as text, never as HTML entities", () => {
    // The WP REST API sends a title as rendered HTML (`The Swan &amp; Angel`).
    // The match rule compares names, so an undecoded entity quietly stops a
    // pub joining its own price row.
    const dir = load<WetherspoonsDirectory>(DIRECTORY_PATHS[0]);
    for (const pub of dir.pubs) {
      expect(pub.name).not.toMatch(/&(#\d+|#x[0-9a-f]+|[a-z]+);/i);
    }
    expect(dir.pubs.some((pub) => pub.name === "The Swan & Angel")).toBe(true);
  });

  it("lists each pub's facilities in taxonomy id order, not the API's order of the day", () => {
    const dir = load<WetherspoonsDirectory>(DIRECTORY_PATHS[0]);
    const idByName = new Map(
      load<Array<{ id: number; name: string }>>("data/wetherspoons/facilities.json").map(
        (facility) => [facility.name, facility.id],
      ),
    );
    for (const pub of dir.pubs as WetherspoonsPub[]) {
      const ids = pub.facilities.map((name) => idByName.get(name) ?? Number.POSITIVE_INFINITY);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    }
  });

  it("keeps one stable order so a refresh diff shows only what changed", () => {
    const dir = load<WetherspoonsDirectory>(DIRECTORY_PATHS[0]);
    const pubs = dir.pubs as WetherspoonsPub[];
    for (let index = 1; index < pubs.length; index += 1) {
      const left = defined(pubs[index - 1]);
      const right = defined(pubs[index]);
      const byKey = `${left.country}|${left.townCity}|${left.name}`.localeCompare(
        `${right.country}|${right.townCity}|${right.name}`,
      );
      expect(byKey < 0 || (byKey === 0 && left.wpId < right.wpId)).toBe(true);
    }
  });

  it("stamps every pub with honest {source, observedAt} provenance", () => {
    const dir = load<WetherspoonsDirectory>(DIRECTORY_PATHS[0]);
    const now = Date.now();
    for (const pub of dir.pubs as WetherspoonsPub[]) {
      expect(pub.source?.label).toBeTruthy();
      expect(pub.source?.url).toMatch(/^https?:\/\//);
      expect(pub.source?.licence).toBeTruthy();
      const observed = Date.parse(pub.observedAt);
      expect(Number.isFinite(observed)).toBe(true);
      // Never present a future observation as if already seen.
      expect(observed).toBeLessThanOrEqual(now);
      // Scraped data is never labelled as community-contributed.
      expect(pub.menuPricesAvailableOnWeb).toBe(false);
    }
  });

  it("has finite, well-ordered [lng, lat] coordinates within sane bounds", () => {
    const geo = load<{
      type: string;
      features: Array<{
        geometry: { coordinates: [number, number] };
        properties: { country: string; name: string };
      }>;
    }>(GEOJSON_PATHS[0]);

    expect(geo.type).toBe("FeatureCollection");
    expect(geo.features).toHaveLength(827);

    let outsideUk = 0;
    for (const feature of geo.features) {
      const [lng, lat] = feature.geometry.coordinates;
      expect(Number.isFinite(lng)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lng)).toBeLessThanOrEqual(180);
      // UK + Ireland box; only the 2 Spanish airport bars fall outside.
      const inUk = lng >= -8.7 && lng <= 1.9 && lat >= 49.8 && lat <= 60.9;
      if (!inUk) {
        outsideUk += 1;
        expect(feature.properties.country).toBe("Spain");
      }
    }
    expect(outsideUk).toBe(2);
  });

  it("keeps the corrected Edinburgh longitude (no North Sea pin)", () => {
    const dir = load<WetherspoonsDirectory>(DIRECTORY_PATHS[0]);
    const edinburgh = dir.pubs.find(
      (pub) => pub.name === "The William Chambers",
    );
    expect(edinburgh).toBeDefined();
    // EH1 1HU is Edinburgh — longitude must be negative (west of Greenwich).
    expect(edinburgh?.longitude).toBeLessThan(0);
    expect(edinburgh?.longitude).toBeCloseTo(-3.19099, 4);
  });
});
