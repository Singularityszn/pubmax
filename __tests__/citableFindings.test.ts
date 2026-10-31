// The findings /press hands a writer (docs/growth/BACKLINK_PLAYBOOK.md, tactics
// 13 to 19). Each is a whole sentence, each figure is read from the Index, and
// a snapshot below the admission floor yields nothing to quote.

import { describe, expect, it } from "vitest";

import { SEED_BOROUGH_MONTHLY_TARGET } from "@/lib/boroughCoverageStatus";
import { citableFindings, citableSample, citationLine } from "@/lib/citableFindings";
import { buildLeagueTable, indexSummary, type PintIndexSnapshot } from "@/lib/pintIndex";
import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";

function snapshotWith(boroughs: readonly [string, string, number, number][]): PintIndexSnapshot {
  const observations = boroughs.flatMap(([code, name, pubCount, basePence]) =>
    Array.from({ length: pubCount }, (_, offset) => ({
      venueId: `${code}-${offset}`,
      pubName: `${name} pub ${offset}`,
      boroughCode: code,
      boroughName: name as PintIndexSnapshot["observations"][number]["boroughName"],
      pricePence: basePence + offset,
      observedAt: "2026-09-10T12:00:00.000Z",
      sourceId: "community-1",
    })),
  );
  return {
    schemaVersion: 1,
    snapshotId: "citable-findings-fixture",
    status: observations.length === 0 ? "empty" : "published",
    generatedAt: "2026-10-01T00:00:00.000Z",
    observationWindow: observations.length === 0
      ? null
      : { start: "2026-09-01T00:00:00.000Z", end: "2026-09-30T23:59:59.999Z" },
    classification: {
      version: LONDON_BOROUGH_CLASSIFIER_VERSION,
      method: "point_in_polygon",
      sourceArtifact: "data/london_boroughs_simplified.json",
      licence: "Open Government Licence v3.0",
    },
    sources: [{
      id: "community-1",
      kind: "confirmed_pint_drop",
      publisher: "PUBMAXX contributor",
      sourceUrl: "https://pubmaxxing.com/evidence/1",
      licence: null,
      confirmationId: "drop-confirmation-1",
      reviewState: "confirmed",
    }],
    observations,
    excluded: [],
  };
}

const AT_FLOOR = snapshotWith([
  ["hackney", "Hackney", SEED_BOROUGH_MONTHLY_TARGET, 550],
  ["westminster", "Westminster", 3, 750],
]);

describe("citableFindings", () => {
  it("says nothing for an empty Index", () => {
    expect(citableFindings(snapshotWith([]))).toEqual([]);
    expect(citableSample(snapshotWith([]))).toBeNull();
  });

  it("says nothing while every borough sits below the admission floor", () => {
    const thin = snapshotWith([["hackney", "Hackney", SEED_BOROUGH_MONTHLY_TARGET - 1, 550]]);
    expect(citableFindings(thin)).toEqual([]);
  });

  it("writes every finding as one complete sentence with its period inside it", () => {
    const findings = citableFindings(AT_FLOOR);
    expect(findings.map((finding) => finding.id)).toEqual([
      "average", "cheapest-borough", "dearest-borough", "borough-gap", "dearest-pint",
    ]);
    for (const { sentence } of findings) {
      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence).toContain("from 1 September 2026 to 30 September 2026");
      expect(sentence).not.toContain("between");
      expect(sentence).not.toMatch(/[—!]/);
    }
  });

  it("quotes only figures the league table holds", () => {
    const summary = indexSummary(buildLeagueTable(AT_FLOOR));
    const byId = Object.fromEntries(citableFindings(AT_FLOOR).map((f) => [f.id, f.sentence]));
    expect(byId.average).toContain(`£${summary.averageGbp?.toFixed(2)}`);
    expect(byId["cheapest-borough"]).toMatch(/^Hackney had the cheapest/);
    expect(byId["dearest-borough"]).toMatch(/^Westminster had the dearest/);
    expect(byId["dearest-pint"]).toContain("£7.52, at Westminster pub 2 in Westminster");
  });

  it("drops the borough comparison when only one borough is listed", () => {
    const one = snapshotWith([["hackney", "Hackney", SEED_BOROUGH_MONTHLY_TARGET, 550]]);
    expect(citableFindings(one).map((finding) => finding.id)).toEqual(["average", "dearest-pint"]);
  });

  it("keeps a summer edition's period inside its own UTC month", () => {
    const june = {
      ...snapshotWith([["hackney", "Hackney", SEED_BOROUGH_MONTHLY_TARGET, 550]]),
      observationWindow: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-30T23:59:59.999Z" },
    };
    june.observations = june.observations.map((row) => ({ ...row, observedAt: "2026-06-10T12:00:00.000Z" }));
    expect(citableSample(june)?.windowLabel).toBe("1 June 2026 to 30 June 2026");
    for (const { sentence } of citableFindings(june)) {
      expect(sentence).toContain("for prices seen from 1 June 2026 to 30 June 2026.");
      expect(sentence).not.toContain("July");
    }
  });

  it("counts the sample a writer needs to check the claim", () => {
    expect(citableSample(AT_FLOOR)).toEqual({
      pubCount: SEED_BOROUGH_MONTHLY_TARGET + 3,
      boroughCount: 2,
      observationCount: SEED_BOROUGH_MONTHLY_TARGET + 3,
      sourceCount: 1,
      windowLabel: "1 September 2026 to 30 September 2026",
    });
  });
});

describe("citationLine", () => {
  it("names the work, the publisher, the day and the link", () => {
    expect(citationLine("London Pint Index, September 2026", "https://pubmaxxing.com/pint-index/2026-09", "1 October 2026"))
      .toBe("Source: London Pint Index, September 2026, PUBMAXX, 1 October 2026. https://pubmaxxing.com/pint-index/2026-09");
  });
});
