import { describe, expect, it } from "vitest";

import {
  binIndex,
  calibrationBins,
  enoughToAct,
  expectedCalibrationError,
  loadDecisions,
  recommendThreshold,
  renderReport,
  thresholdTable,
  wilsonLowerBound,
} from "@/scripts/calibration_report.mjs";

/**
 * The arithmetic behind `node scripts/calibration_report.mjs`. A report that
 * recommends a floor is only as good as its bins, its calibration error and
 * its threshold search, so each is held to a case worked by hand.
 */
describe("calibration arithmetic", () => {
  it("bins a probability into tenths and keeps 1.0 in the top bin", () => {
    expect([0, 0.09, 0.1, 0.55, 0.99, 1].map(binIndex)).toEqual([0, 0, 1, 5, 9, 9]);
  });

  it("scores a calibrated set at zero and an overconfident one at its gap", () => {
    const calibrated = [
      ...Array.from({ length: 8 }, () => ({ probability: 0.8, correct: true })),
      ...Array.from({ length: 2 }, () => ({ probability: 0.8, correct: false })),
    ];
    expect(expectedCalibrationError(calibrated)).toBeCloseTo(0, 10);
    const overconfident = Array.from({ length: 10 }, (_, index) => ({ probability: 0.95, correct: index < 5 }));
    expect(expectedCalibrationError(overconfident)).toBeCloseTo(0.45, 10);
    expect(expectedCalibrationError([])).toBeNull();
  });

  it("reports count, mean confidence and accuracy per bin", () => {
    const bins = calibrationBins([
      { probability: 0.91, correct: true },
      { probability: 0.99, correct: false },
      { probability: 0.12, correct: false },
    ]);
    expect(bins[9]).toMatchObject({ count: 2, meanConfidence: 0.95, accuracy: 0.5 });
    expect(bins[1]).toMatchObject({ count: 1, accuracy: 0 });
    expect(bins[5]).toMatchObject({ count: 0, meanConfidence: null, accuracy: null });
  });

  it("gives the Wilson lower bound for nine of ten", () => {
    expect(wilsonLowerBound(9, 10)).toBeCloseTo(0.596, 3);
    expect(wilsonLowerBound(0, 0)).toBeNull();
  });

  it("recommends the lowest threshold whose cases above it are 95% right", () => {
    const rows = [
      { score: 0.15, correct: false, shouldClear: false },
      { score: 0.35, correct: false, shouldClear: false },
      { score: 0.38, correct: false, shouldClear: false },
      ...Array.from({ length: 20 }, () => ({ score: 0.9, correct: true, shouldClear: true })),
    ];
    const table = thresholdTable(rows);
    const pick = recommendThreshold(table);
    expect(pick).toMatchObject({ threshold: 0.4, count: 20, accuracy: 1, recall: 1 });
    expect(table[0]).toMatchObject({ count: 23, share: 1 });
    // At 0.3, 20 of 22 are right: 91%, under the bar.
    expect(table[3]).toMatchObject({ count: 22 });
    expect(enoughToAct(pick)).toBe(true);
    expect(enoughToAct(recommendThreshold(thresholdTable(rows.slice(0, 5))))).toBe(false);
  });
});

describe("the recorded decisions", () => {
  it("grades every decision the report names, and only hand labels for the label-graded ones", () => {
    const decisions = loadDecisions();
    expect(decisions.map((decision) => decision.name)).toEqual([
      "Ask router: tool choice",
      "Ask router: wantsMap",
      "Pub Pal fence: fires",
      "Pub Pal fence: fitToTravelAfterDrinking",
      "Pub Pal fence: getHomeTonight",
      "Same pub: merge",
      "Heritage listing: is the pub building",
    ]);
    for (const decision of decisions) {
      expect(decision.rows.length, decision.name).toBeGreaterThan(0);
      for (const row of decision.rows) {
        expect(row.probability, `${decision.name} ${row.id}`).toBeGreaterThanOrEqual(0);
        expect(row.probability, `${decision.name} ${row.id}`).toBeLessThanOrEqual(1);
      }
    }
    expect(decisions.find((decision) => decision.name === "Same pub: merge")?.rows.length).toBe(10);
  });

  it("renders a report that names each threshold in code", () => {
    const report = renderReport(loadDecisions(), "2026-10-18");
    expect(report).toContain("# TypeSafe calibration report, 2026-10-18");
    for (const constant of [
      "ASK_ROUTER_TOOL_FLOOR",
      "PUB_PAL_FENCE_NOUL_THRESHOLD",
      "SAME_PUB_MERGE_THRESHOLD",
      "HERITAGE_STRUCTURE_ACCEPT_THRESHOLD",
    ]) {
      expect(report).toContain(constant);
    }
  });
});
