// A MODELLED PRICE MAY NOT REACH A LANE THAT SPEAKS WITH AUTHORITY.
//
// Same fence lib/priceHistory.ts wears, for the same reason and against the
// same list of surfaces. A historical price is not about tonight; a modelled
// price was never observed at all. Both would be figures nobody can correct if
// they got into the Pint Index, the price bands, the cheapest-pint buckets or
// any current-price merge.
//
// The fence is on the SOURCE, not on a list of files somebody remembered to
// inspect: it walks the tree and fails on any authority module that so much as
// mentions the engine.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { PRICE_STANDINGS, standingCarriesAuthority } from "@/lib/priceTier";

const ROOT = join(__dirname, "..");

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkSource(full, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const sourceFiles = ["app", "components", "lib", "scripts"]
  .map((dir) => join(ROOT, dir))
  .flatMap((dir) => walkSource(dir));

// Every module the price-history fence already names, because these are the
// surfaces that answer "what does a pint cost here" as a fact.
const AUTHORITY_MODULES = [
  "components/map/communityPriceSignals.ts",
  "lib/venues.ts",
  "lib/priceUpdates.ts",
  "lib/drinkPriceUpdates.ts",
  "lib/foodPriceUpdates.ts",
  "lib/communityPrice.ts",
  "lib/communityPriceStore.ts",
  "lib/venuePriceIndex.ts",
  "lib/mapPriceLegend.ts",
  "lib/pintIndex.ts",
  "lib/pintIndexArchive.ts",
  "lib/pintIndexCanonical.mjs",
  "lib/freshness.ts",
];

describe("the estimate engine's authority fence", () => {
  it("is not reached by any module that answers a price as a fact", () => {
    for (const modulePath of AUTHORITY_MODULES) {
      let source: string;
      try {
        source = readFileSync(join(ROOT, modulePath), "utf8");
      } catch {
        continue; // a module that no longer exists cannot import anything
      }
      expect(source, `${modulePath} must not read modelled prices`).not.toMatch(/priceEstimate/);
    }
  });

  it("is reached only by the surfaces that present an estimate as an estimate", () => {
    const ALLOWED = new Set([
      "lib/priceEstimate.ts",
      "lib/priceEstimateBaselines.ts",
      "app/how-we-estimate/page.tsx",
      "scripts/build_price_estimate_baselines.mjs",
    ]);
    const importers = sourceFiles
      .filter((file) => /from\s+["']@\/lib\/priceEstimate(Baselines)?["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    for (const importer of importers) {
      expect(ALLOWED.has(importer), `${importer} reads the estimate engine and is not on the list`).toBe(true);
    }
  });

  it("keeps the Pint Index snapshot free of a modelled source kind", () => {
    const pintIndex = readFileSync(join(ROOT, "lib/pintIndex.ts"), "utf8");
    for (const word of ["estimate", "modelled", "baseline"]) {
      expect(pintIndex.toLowerCase(), `the Index must not admit a ${word} source`).not.toMatch(
        new RegExp(`kind:\\s*"[^"]*${word}`, "i"),
      );
    }
  });

  it("answers the authority question for every standing, so a new one cannot default to true", () => {
    const answered = PRICE_STANDINGS.map(standingCarriesAuthority);
    expect(answered).toEqual([true, true, false, false]);
    expect(answered).toHaveLength(PRICE_STANDINGS.length);
  });
});
