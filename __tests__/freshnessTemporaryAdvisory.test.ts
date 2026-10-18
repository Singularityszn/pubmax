// A TEMPORARY ADVISORY EXEMPTION LAPSES ON ITS OWN.
//
// The gate may warn instead of failing while a review a person owes is
// outstanding, but only until a stated instant. From then on the same finding
// fails the gate again, so an exemption cannot quietly outlive its reason, and
// the entry leaves in the commit that clears the finding. late_food_evidence
// held one until its rows were re-reviewed (docs/LATE_FOOD_EVIDENCE_RUNBOOK.md).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TEMPORARY_ADVISORY_UNTIL, isAdvisoryStale } from "@/scripts/check_freshness.mjs";

const ROOT = process.cwd();
const registry = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));

describe("temporary advisory exemptions", () => {
  it("name only datasets the registry declares, each with a parseable lapse", () => {
    const ids = new Set(registry.datasets.map((d: { id: string }) => d.id));
    for (const [id, until] of Object.entries(TEMPORARY_ADVISORY_UNTIL)) {
      expect(ids.has(id)).toBe(true);
      expect(Number.isFinite(Date.parse(until as string))).toBe(true);
    }
  });

  it("leave the standing advisory lanes and every other dataset as they were", () => {
    const later = new Date("2099-01-01T00:00:00.000Z");
    expect(isAdvisoryStale("area_news", later)).toBe(true);
    expect(isAdvisoryStale("google_places_content", later)).toBe(true);
    expect(isAdvisoryStale("famous_venues", new Date("2026-11-15T23:00:00.000Z"))).toBe(false);
    expect(isAdvisoryStale("late_food_evidence", new Date("2026-11-15T23:00:00.000Z"))).toBe(false);
  });
});
