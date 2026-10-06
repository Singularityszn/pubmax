import { readFileSync } from "node:fs";
import { join } from "node:path";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

import {
  SEED_BOROUGH_CAMPAIGN,
  SEED_BOROUGH_MONTHLY_TARGET,
  boroughCoverageMapHref,
  boroughCoverageStatusCopy,
  boroughCoverageSummary,
} from "@/lib/boroughCoverageStatus";

describe("boroughCoverageStatusCopy", () => {
  it("names remaining corroborated pints without gamifying", () => {
    expect(
      boroughCoverageStatusCopy({
        slug: "camden",
        name: "Camden",
        mapQuery: "Camden",
        corroboratedPintCount: 8,
        target: 20,
        status: "ready",
      }),
    ).toBe("Camden needs 12 more corroborated pints this month.");
  });

  it("uses singular pint when one remains", () => {
    expect(
      boroughCoverageStatusCopy({
        slug: "camden",
        name: "Camden",
        mapQuery: "Camden",
        corroboratedPintCount: 19,
        status: "ready",
      }),
    ).toBe("Camden needs 1 more corroborated pint this month.");
  });

  it("says the target is met without inventing a leaderboard", () => {
    expect(
      boroughCoverageStatusCopy({
        slug: "camden",
        name: "Camden",
        mapQuery: "Camden",
        corroboratedPintCount: SEED_BOROUGH_MONTHLY_TARGET,
        status: "ready",
      }),
    ).toBe("Camden has met its 20 corroborated pints for this month.");
  });

  it("never treats a failed read as an empty borough", () => {
    expect(
      boroughCoverageStatusCopy({
        slug: "camden",
        name: "Camden",
        mapQuery: "Camden",
        corroboratedPintCount: 0,
        status: "degraded",
      }),
    ).toBe("Camden: we could not count corroborated pints just now.");
  });

  it("marks truncated scans as a floor", () => {
    expect(
      boroughCoverageStatusCopy({
        slug: "camden",
        name: "Camden",
        mapQuery: "Camden",
        corroboratedPintCount: 3,
        status: "partial",
      }),
    ).toContain("the count may run higher");
  });
});

describe("seed borough campaign", () => {
  it("keeps five soft-launch patches", () => {
    expect(SEED_BOROUGH_CAMPAIGN).toHaveLength(5);
  });

  it("keeps one row per borough slug", () => {
    const slugs = SEED_BOROUGH_CAMPAIGN.map(({ slug }) => slug);

    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("includes the Islington patch and its map destination", () => {
    expect(SEED_BOROUGH_CAMPAIGN).toContainEqual({
      slug: "islington",
      name: "Islington",
      mapQuery: "Islington",
    });
    expect(boroughCoverageMapHref("Islington")).toBe("/map?q=Islington");
  });
});

describe("boroughCoverageSummary", () => {
  // The counts are real and per-borough. On 30 August 2026 they were also all
  // zero, so the page printed "needs 20 more corroborated pints this month"
  // five times over. Five identical sentences carry one fact, not five.
  const row = (over: Partial<Parameters<typeof boroughCoverageStatusCopy>[0]> = {}) => ({
    slug: "westminster",
    name: "Soho / Westminster",
    mapQuery: "Soho",
    corroboratedPintCount: 0,
    status: "ready" as const,
    ...over,
  });

  const allZero = SEED_BOROUGH_CAMPAIGN.map((borough) => row({ ...borough }));

  it("says it once when every borough is saying the same thing", () => {
    expect(boroughCoverageSummary(allZero)).toEqual({
      kind: "shared",
      line: "Every borough here needs 20 more corroborated pints this month.",
    });
  });

  it("goes back to a line each the moment one borough moves ahead", () => {
    const moved = allZero.map((borough, index) =>
      index === 0 ? { ...borough, corroboratedPintCount: 3 } : borough,
    );
    expect(boroughCoverageSummary(moved)).toEqual({ kind: "per-borough" });
  });

  it("names the shared read failure rather than a shared zero", () => {
    const degraded = allZero.map((borough) => ({ ...borough, status: "degraded" as const }));
    expect(boroughCoverageSummary(degraded)).toEqual({
      kind: "shared",
      line: "We could not count corroborated pints just now.",
    });
  });

  it("says it once when every borough has met the target", () => {
    const met = allZero.map((borough) => ({ ...borough, corroboratedPintCount: 20 }));
    expect(boroughCoverageSummary(met)).toEqual({
      kind: "shared",
      line: "Every borough here has met its 20 corroborated pints for this month.",
    });
  });

  it("leaves a single borough to speak for itself", () => {
    expect(boroughCoverageSummary(allZero.slice(0, 1))).toEqual({ kind: "per-borough" });
  });

  it("claims nothing about boroughs it is not counting", () => {
    // "Every borough here" is the five listed patches, never all of London.
    const summary = boroughCoverageSummary(allZero);
    expect(summary.kind).toBe("shared");
    if (summary.kind !== "shared") return;
    expect(summary.line).toContain("Every borough here");
    expect(summary.line).not.toMatch(/every London borough|all boroughs/i);
  });
});

describe("the borough coverage link", () => {
  it("is coloured by the accent-ink token, not the browser's default link blue", () => {
    const sheet = postcss.parse(
      readFileSync(join(process.cwd(), "components/pintindex/boroughCoverageStatus.css"), "utf8"),
    );
    const colours: string[] = [];
    sheet.walkRules((rule) => {
      if (!rule.selectors.includes(".boroughCoverageLink")) return;
      rule.walkDecls("color", (decl) => {
        colours.push(decl.value.trim());
      });
    });
    expect(colours).toEqual(["var(--color-accent-ink)"]);
  });
});
