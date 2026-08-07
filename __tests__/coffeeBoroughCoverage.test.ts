import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error - plain .mjs ops script, no type declarations
import {
  ALL_REPORT_CATEGORIES,
  areaForVenue,
  DAY_MS,
  drivesMap,
  formatCoffeeBoroughReport,
  reportCoffeeBoroughCoverage,
} from "../scripts/report_coffee_borough_coverage.mjs";

const FIXTURE_PATH = join(
  __dirname,
  "fixtures/coffee_borough_coverage.json",
);

const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

/** Fresh relative to the fixture's in-window submittedAt (1770000000000). */
const NOW = 1_770_000_000_000 + 5 * DAY_MS;

describe("report_coffee_borough_coverage", () => {
  it("drivesMap requires corroboration threshold and max age", () => {
    expect(
      drivesMap({ corroborations: 2, submittedAt: NOW - DAY_MS }, NOW),
    ).toBe(true);
    expect(
      drivesMap({ corroborations: 1, submittedAt: NOW - DAY_MS }, NOW),
    ).toBe(false);
    expect(
      drivesMap(
        { corroborations: 5, submittedAt: NOW - 31 * DAY_MS },
        NOW,
      ),
    ).toBe(false);
  });

  it("prefers borough and falls back to nightArea", () => {
    expect(areaForVenue({ borough: "Camden" })).toEqual({
      kind: "borough",
      name: "Camden",
    });
    expect(areaForVenue({ nightArea: "clapham" })).toEqual({
      kind: "night-area",
      name: "clapham",
    });
    expect(areaForVenue({})).toEqual({
      kind: "unmatched",
      name: "(unmatched)",
    });
  });

  it("counts venues with ≥1 corroborated in-window coffee price per borough", () => {
    const report = reportCoffeeBoroughCoverage(FIXTURE, {
      categories: ["coffee"],
      now: NOW,
    });

    const byName = Object.fromEntries(
      report.rows.map((row: { name: string }) => [row.name, row]),
    );

    // Camden: venue-camden-a qualifies; venue-camden-b is lone (corroborations 1).
    // The ancient corroborated coffee on camden-a is outside the age window and
    // does not help; the fresh corroborations:2 row does.
    expect(byName.Camden.counts.coffee).toBe(1);
    expect(byName.Camden.venues).toBe(2);

    // Westminster: corroborated coffee in window.
    expect(byName.Westminster.counts.coffee).toBe(1);

    // Islington has a venue but no qualifying coffee.
    expect(byName.Islington.counts.coffee).toBe(0);

    // Clapham row exists via nightArea; no coffee there.
    expect(byName.clapham.kind).toBe("night-area");
    expect(byName.clapham.counts.coffee).toBe(0);

    expect(report.totals.coffee).toBe(2);
  });

  it("optionally reports alcohol-free and soft-drink on the same gate", () => {
    const report = reportCoffeeBoroughCoverage(FIXTURE, {
      categories: [...ALL_REPORT_CATEGORIES],
      now: NOW,
    });

    const byName = Object.fromEntries(
      report.rows.map((row: { name: string }) => [row.name, row]),
    );

    expect(byName.Westminster.counts["alcohol-free"]).toBe(1);
    expect(byName.clapham.counts["soft-drink"]).toBe(1);
    expect(byName.Camden.counts["alcohol-free"]).toBe(0);
    expect(report.totals["soft-drink"]).toBe(1);
  });

  it("formats a readable ops table without inventing seed advice", () => {
    const report = reportCoffeeBoroughCoverage(FIXTURE, {
      categories: ["coffee"],
      now: NOW,
    });
    const text = formatCoffeeBoroughReport(report);
    expect(text).toContain("Camden");
    expect(text).toContain("Never seed prices");
    expect(text).not.toContain("\u2014");
  });

  it("loads the committed fixture file (no network)", () => {
    expect(FIXTURE.venues.length).toBeGreaterThan(0);
    expect(FIXTURE.prices.length).toBeGreaterThan(0);
  });
});
