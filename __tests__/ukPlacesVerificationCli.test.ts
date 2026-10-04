import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function dryRun(priorDetails: number) {
  const env = { ...process.env };
  delete env.GOOGLE_PLACES_API_KEY;
  const output = execFileSync(process.execPath, [
    "--import", "tsx", "scripts/verify_london_places.mjs", "--uk-cities",
    "--dry-run", `--prior-details=${priorDetails}`,
  ], { encoding: "utf8", env });
  return JSON.parse(output.trim());
}

describe("UK city closure verification dry run", () => {
  it("plans cities in captain order without a Places key or paid calls", () => {
    const plan = dryRun(3130);
    expect(plan.cities.slice(0, 7).map((city: { id: string }) => city.id)).toEqual([
      "manchester", "birmingham", "edinburgh", "glasgow", "leeds", "bristol", "liverpool",
    ]);
    expect(plan.projectedUsd).toBeLessThanOrEqual(40);
    expect(plan.pubsConsidered).toBe(4222);
  });

  it("does not count free ID searches against the Details free allowance", () => {
    const plan = dryRun(0);
    expect(plan.pubsConsidered).toBeGreaterThan(5000);
    expect(plan.projectedUsd).toBeLessThanOrEqual(40);
  });

  it("charges only this job when the monthly free allowance is exhausted", () => {
    const plan = dryRun(6000);
    expect(plan.pubsConsidered).toBe(2352);
    expect(plan.projectedUsd).toBe(39.984);
  });
});


describe("published UK city verdict ledger", () => {
  const ledger = JSON.parse(readFileSync("data/places_verification/uk_cities.json", "utf8"));

  it("accounts for every considered pub and every paid attempt within the cap", () => {
    const unknown = ledger.verdicts.filter((row: { skipped?: string }) => row.skipped).length;
    expect(ledger.summary.pubsVerified + ledger.summary.skippedNoResult
      + ledger.summary.skippedAmbiguous + unknown).toBe(ledger.summary.pubsConsidered);
    expect(ledger.verdicts).toHaveLength(ledger.summary.pubsConsidered);
    expect(ledger.spend.detailsAttempts).toBeGreaterThanOrEqual(ledger.summary.pubsVerified);
    expect(ledger.spend.actualTariffUsd).toBeLessThanOrEqual(40);
    expect(ledger.spend.skus.reduce((sum: number, sku: { projectedUsd: number }) => sum + sku.projectedUsd, 0))
      .toBeCloseTo(ledger.spend.actualTariffUsd, 8);
  });

  it("stores only place IDs, our identity fields and derived verdicts per pub", () => {
    const allowed = new Set([
      "venueId", "osmRef", "city", "outcome", "placeId", "reason", "closure",
      "nameMatched", "operational", "skipped", "verifiedAt",
    ]);
    for (const row of ledger.verdicts) {
      expect(Object.keys(row).filter((key) => !allowed.has(key))).toEqual([]);
    }
    for (const row of ledger.pubs) {
      expect(Object.keys(row).sort()).toEqual(["googlePlaceId", "venueId", "verifiedAt"]);
    }
  });
});
