import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatMonthYear,
  formatObservedDate,
  isoDate,
  PINT_DATASET_OBSERVED_AT,
} from "@/lib/dataFreshness";

type FreshnessRegistryFile = {
  datasets: { id: string; stamp: { kind: string; value?: string } | null }[];
};

/**
 * The registry stamp read straight off disk, an independent path from the
 * module's build-time import, so a hand-authored regression cannot satisfy
 * both sides at once.
 */
function readRegistry(): FreshnessRegistryFile {
  return JSON.parse(
    readFileSync(join(process.cwd(), "data", "freshness_registry.json"), "utf8"),
  ) as FreshnessRegistryFile;
}

function registryStampValue(): string {
  const value = readRegistry().datasets.find((d) => d.id === "pint_prices")?.stamp?.value;
  if (typeof value !== "string") {
    throw new Error("data/freshness_registry.json: pint_prices has no literal stamp value");
  }
  return value;
}

// SEO integrity regression: the visible "collected" stamp (en-GB,
// Europe/London) and the JSON-LD ISO date must name the SAME calendar day.
// The first extract's raw instant (2026-07-03T23:10:47Z) is already 4 July in
// London, which is exactly the bug this pins against: the constant is anchored
// at noon UTC so no timezone conversion can move the day.
//
// The expected day is DERIVED from the registry stamp rather than typed, so a
// re-collection updates one value (the registry) and this still holds the two
// representations to the same day. A hardcoded day here would turn every
// honest refresh into a test edit, which is how a stamp stops being refreshed.
describe("PINT_DATASET_OBSERVED_AT", () => {
  const registryDay = new Date(registryStampValue());

  it("renders the same day to users and to JSON-LD", () => {
    expect(formatObservedDate(PINT_DATASET_OBSERVED_AT)).toBe(
      formatObservedDate(registryDay),
    );
    expect(isoDate(PINT_DATASET_OBSERVED_AT)).toBe(isoDate(registryDay));
  });

  it("keeps the month stamp on the collection month", () => {
    expect(formatMonthYear(PINT_DATASET_OBSERVED_AT)).toBe(
      formatMonthYear(registryDay),
    );
  });

  it("is anchored mid-day so London/UTC agree in both BST and GMT", () => {
    expect(PINT_DATASET_OBSERVED_AT.getUTCHours()).toBe(12);
  });
});

// Drift guard: the constant is DERIVED from the freshness registry (the single
// source of truth), so it must equal the registry stamp exactly. Read the raw
// JSON here via fs — an independent path from the module's build-time import —
// so a hand-authored regression (re-hardcoding the date in lib/dataFreshness.ts,
// or editing the registry without the pipeline) fails loudly instead of leaving
// two silently-diverging copies. This kills the mirror class for good.
describe("PINT_DATASET_OBSERVED_AT ↔ freshness registry (single source of truth)", () => {
  const pintEntry = readRegistry().datasets.find((d) => d.id === "pint_prices");

  it("has a literal registry stamp for the pint dataset", () => {
    expect(pintEntry).toBeDefined();
    expect(pintEntry?.stamp?.kind).toBe("literal");
    expect(typeof pintEntry?.stamp?.value).toBe("string");
  });

  it("derives the constant from the registry value with no drift", () => {
    const registryValue = pintEntry?.stamp?.value as string;
    expect(PINT_DATASET_OBSERVED_AT.toISOString()).toBe(
      new Date(registryValue).toISOString(),
    );
  });
});
