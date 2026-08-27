import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCALAR_METRE_DISTANCE_CONSUMERS = [
  "scripts/lib/venueCanonicalization.mjs",
  "scripts/lib/heritageMatch.mjs",
  "scripts/lib/ukOsmSeed.mjs",
  "scripts/integrate_wikipedia_london_pubs.mjs",
] as const;

const ALLOWED_KILOMETRE_FORMULA_OWNERS = new Set([
  "scripts/gen_london_localities.mjs",
  "scripts/lib/postcodeCoordinateConsistency.mjs",
  "scripts/lib/stationZones.mjs",
  "scripts/lib/ukPlaceIndex.mjs",
]);

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

  it("sweeps script modules for a second great-circle formula owner", () => {
    const root = process.cwd();
    for (const absolutePath of scriptModules(join(root, "scripts"))) {
      const relativePath = absolutePath.slice(root.length + 1);
      if (relativePath === "scripts/lib/geo.mjs") continue;
      const source = readFileSync(absolutePath, "utf8");
      const normalizedNumbers = source.replaceAll("_", "").toLowerCase();
      expect(normalizedNumbers, relativePath).not.toMatch(/6371000|6\.371e\+?6/);
      if (ALLOWED_KILOMETRE_FORMULA_OWNERS.has(relativePath)) continue;
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
