import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const SCALAR_METRE_DISTANCE_CONSUMERS = [
  "scripts/lib/venueCanonicalization.mjs",
  "scripts/lib/heritageMatch.mjs",
  "scripts/lib/ukOsmSeed.mjs",
  "scripts/integrate_wikipedia_london_pubs.mjs",
] as const;

const SCALAR_KILOMETRE_DISTANCE_CONSUMERS = [
  "scripts/lib/postcodeCoordinateConsistency.mjs",
  "scripts/lib/stationZones.mjs",
  "scripts/lib/ukPlaceIndex.mjs",
] as const;

function scriptModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return scriptModules(absolute);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [absolute] : [];
  });
}

describe("script great-circle distance", () => {
  it("keeps existing metre exports numerically compatible", async () => {
    const { haversineMeters } = await import("@/scripts/lib/geo.mjs");
    const { haversineMeters: canonicalizationDistance } = await import(
      "@/scripts/lib/venueCanonicalization.mjs"
    );
    // @ts-expect-error - heritage script has no declaration file.
    const { haversineMeters: heritageDistance } = await import("@/scripts/lib/heritageMatch.mjs");
    const { haversineMeters: osmDistance } = await import("@/scripts/lib/ukOsmSeed.mjs");
    const coordinates = [51.5074, -0.1278, 55.9533, -3.1883] as const;

    const originalThreeOfFourValue = 533_652.20033900486;
    expect(haversineMeters(...coordinates)).toBe(originalThreeOfFourValue);
    expect(canonicalizationDistance(...coordinates)).toBe(originalThreeOfFourValue);
    expect(heritageDistance(...coordinates)).toBe(originalThreeOfFourValue);
    expect(osmDistance(...coordinates)).toBe(originalThreeOfFourValue);
  });

  it("keeps migrated consumers on the canonical script owner", () => {
    for (const relativePath of SCALAR_METRE_DISTANCE_CONSUMERS) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).toMatch(/(?:\.\/(?:lib\/)?|\.\.\/lib\/)geo\.mjs/);
      expect(source, relativePath).not.toMatch(/Math\.(?:sin|cos|asin|acos|atan2)\s*\(/);
    }
  });

  it("keeps existing kilometre exports numerically compatible", async () => {
    const { haversineKm } = await import("@/scripts/lib/geo.mjs");
    const { haversineKm: stationDistance } = await import("@/scripts/lib/stationZones.mjs");
    const { haversineDistanceKm: postcodeDistance } = await import(
      "@/scripts/lib/postcodeCoordinateConsistency.mjs"
    );
    const coordinates = [51.5074, -0.1278, 55.9533, -3.1883] as const;

    const originalStationValue = 533.6522003390048;
    const originalPostcodeValue = 533.6522003390049;
    expect(haversineKm(...coordinates)).toBe(originalStationValue);
    expect(stationDistance(...coordinates)).toBe(originalStationValue);
    expect(postcodeDistance(...coordinates)).toBeCloseTo(originalPostcodeValue, 12);
  });

  it("keeps longitude-first generator coordinates in longitude-first order", async () => {
    const { haversineKm } = await import("@/scripts/lib/geo.mjs");
    const { localityDistanceKm } = await import("@/scripts/gen_london_localities.mjs");
    const longitudeFirst = [-0.1278, 51.5074, -3.1883, 55.9533] as const;

    expect(localityDistanceKm(...longitudeFirst)).toBe(533.6522003390048);
    expect(localityDistanceKm(...longitudeFirst)).toBe(
      haversineKm(51.5074, -0.1278, 55.9533, -3.1883),
    );
    expect(localityDistanceKm(...longitudeFirst)).not.toBe(
      haversineKm(...longitudeFirst),
    );
  });

  it("recognises absolute, relative, and symlinked direct entry paths", async () => {
    const scriptPath = join(process.cwd(), "scripts/gen_london_localities.mjs");
    const moduleUrl = pathToFileURL(scriptPath).href;
    const { isDirectRun } = await import("@/scripts/gen_london_localities.mjs");
    const tempDir = mkdtempSync(join(tmpdir(), "pubmax-localities-entry-"));
    const symlinkPath = join(tempDir, "localities.mjs");
    try {
      symlinkSync(scriptPath, symlinkPath);
      expect(isDirectRun(scriptPath, moduleUrl)).toBe(true);
      expect(isDirectRun(relative(process.cwd(), scriptPath), moduleUrl)).toBe(true);
      expect(isDirectRun(symlinkPath, moduleUrl)).toBe(true);
      expect(isDirectRun(join(tempDir, "missing.mjs"), moduleUrl)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports a missing default direct-entry path", async () => {
    const { isDirectRun } = await import("@/scripts/gen_london_localities.mjs");
    const original = process.argv[1];
    process.argv[1] = join(tmpdir(), "pubmax-missing-localities-entry.mjs");
    try {
      expect(() => isDirectRun()).toThrow();
    } finally {
      process.argv[1] = original;
    }
  });

  it.each([5, 30])("keeps the %i kilometre decision boundary stable", async (threshold) => {
    const { haversineKm } = await import("@/scripts/lib/geo.mjs");
    const insideDelta = ((threshold - 0.0001) / 6_371) * (180 / Math.PI);
    const outsideDelta = ((threshold + 0.0001) / 6_371) * (180 / Math.PI);

    expect(haversineKm(0, 0, insideDelta, 0)).toBeLessThan(threshold);
    expect(haversineKm(0, 0, outsideDelta, 0)).toBeGreaterThan(threshold);
  });

  it("keeps the UK place cluster decision on both sides of 30 kilometres", async () => {
    const { buildUkPlaceIndex } = await import("@/scripts/lib/ukPlaceIndex.mjs");
    const placeNode = (id: number, lat: number) => ({
      type: "node",
      id,
      lat,
      lon: 0,
      tags: { amenity: "pub", name: `Pub ${id}`, "addr:village": "Newton" },
    });

    expect(buildUkPlaceIndex([placeNode(1, 0), placeNode(2, 0.2697)]).places).toHaveLength(1);
    expect(buildUkPlaceIndex([placeNode(1, 0), placeNode(2, 0.2699)]).places).toHaveLength(2);
  });

  it("keeps compatible kilometre consumers on the canonical script owner", () => {
    for (const relativePath of SCALAR_KILOMETRE_DISTANCE_CONSUMERS) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).toMatch(/\.\/geo\.mjs/);
      expect(source, relativePath).not.toMatch(/Math\.(?:sin|cos|asin|acos|atan2)\s*\(/);
    }
  });

  it("sweeps script modules for a second great-circle formula owner", () => {
    const root = process.cwd();
    for (const absolutePath of scriptModules(join(root, "scripts"))) {
      const relativePath = absolutePath.slice(root.length + 1);
      if (relativePath === "scripts/lib/geo.mjs") continue;
      const source = readFileSync(absolutePath, "utf8");
      const normalizedNumbers = source.replaceAll("_", "").toLowerCase();
      expect(normalizedNumbers, relativePath).not.toMatch(/6371000|6\.371e\+?6/);
      const ownsGreatCircleTrig = /Math\.(?:asin|atan2)\s*\(/.test(source)
        && /Math\.sin\s*\(/.test(source)
        && /Math\.cos\s*\(/.test(source);
      expect(ownsGreatCircleTrig, relativePath).toBe(false);
    }
  });

  it.each([45, 100, 120, 150, 350])(
    "keeps the %i metre decision boundary stable",
    async (threshold) => {
      const { haversineMeters } = await import("@/scripts/lib/geo.mjs");
      const insideDelta = ((threshold - 0.1) / 6_371_000) * (180 / Math.PI);
      const outsideDelta = ((threshold + 0.1) / 6_371_000) * (180 / Math.PI);

      expect(haversineMeters(0, 0, insideDelta, 0)).toBeLessThan(threshold);
      expect(haversineMeters(0, 0, outsideDelta, 0)).toBeGreaterThan(threshold);
    },
  );
});
