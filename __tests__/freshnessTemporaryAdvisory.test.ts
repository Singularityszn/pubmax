// A TEMPORARY ADVISORY EXEMPTION LAPSES ON ITS OWN.
//
// late_food_evidence turned the freshness gate red on main the moment the row
// expiry check landed: every row expired on 2026-08-16 and only a person can
// re-review them (docs/LATE_FOOD_EVIDENCE_RUNBOOK.md). The gate may warn
// instead of failing while that review is owed, but only until a stated
// instant. From then on the same finding fails the gate again, so the
// exemption cannot quietly outlive its reason.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TEMPORARY_ADVISORY_UNTIL,
  evaluateFreshness,
  freshnessGateFailed,
  isAdvisoryStale,
} from "@/scripts/check_freshness.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();
const registry = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
const LAPSE = defined(TEMPORARY_ADVISORY_UNTIL.late_food_evidence);

async function lateFoodResults(now: Date) {
  const dataset = registry.datasets.find((d: { id: string }) => d.id === "late_food_evidence");
  const { results } = await evaluateFreshness({
    registry: { version: registry.version, datasets: [dataset] },
    now,
    rootDir: ROOT,
  });
  return results;
}

describe("temporary advisory exemptions", () => {
  it("name only datasets the registry declares, each with a parseable lapse", () => {
    const ids = new Set(registry.datasets.map((d: { id: string }) => d.id));
    for (const [id, until] of Object.entries(TEMPORARY_ADVISORY_UNTIL)) {
      expect(ids.has(id)).toBe(true);
      expect(Number.isFinite(Date.parse(until))).toBe(true);
    }
  });

  it("let a stale late_food_evidence warn before the lapse and fail the gate from it", async () => {
    const before = new Date(Date.parse(LAPSE) - 60 * 60 * 1000);
    const results = await lateFoodResults(before);
    expect(defined(results[0]).status).toBe("stale");
    expect(isAdvisoryStale("late_food_evidence", before)).toBe(true);
    expect(freshnessGateFailed(results, { now: before })).toBe(false);

    const at = new Date(LAPSE);
    expect(isAdvisoryStale("late_food_evidence", at)).toBe(false);
    expect(freshnessGateFailed(results, { now: at })).toBe(true);
  });

  it("leave the standing advisory lanes and every other dataset as they were", () => {
    const later = new Date("2099-01-01T00:00:00.000Z");
    expect(isAdvisoryStale("area_news", later)).toBe(true);
    expect(isAdvisoryStale("google_places_content", later)).toBe(true);
    expect(isAdvisoryStale("famous_venues", new Date(Date.parse(LAPSE) - 1))).toBe(false);
  });
});
