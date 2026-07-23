import { describe, expect, it } from "vitest";

import {
  MIN_REPORTS_TO_SUMMARISE,
  recencyWeight,
  summariseVisitReports,
  VISIT_REPORT_HALF_LIFE_DAYS,
} from "@/lib/visitReportSummary";
import type {
  Atmosphere,
  Busyness,
  PriceSanity,
  VisitReportDTO,
  WouldReturn,
} from "@/lib/visitReports";

const NOW = new Date("2026-07-21T20:00:00Z");

/** A day key `n` days before the injected "today" (2026-07-21). */
function daysAgoKey(n: number): string {
  const d = new Date(Date.UTC(2026, 6, 21));
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function report(over: {
  visitedAt: string;
  busyness?: Busyness | null;
  atmosphere?: Atmosphere | null;
  wouldReturn?: WouldReturn | null;
  priceSanity?: PriceSanity | null;
}): Pick<VisitReportDTO, "visitedAt" | "busyness" | "atmosphere" | "wouldReturn" | "priceSanity"> {
  return {
    visitedAt: over.visitedAt,
    busyness: over.busyness ?? null,
    atmosphere: over.atmosphere ?? null,
    wouldReturn: over.wouldReturn ?? null,
    priceSanity: over.priceSanity ?? null,
  };
}

describe("recencyWeight", () => {
  it("halves every half-life and never exceeds 1", () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(VISIT_REPORT_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 5);
    expect(recencyWeight(2 * VISIT_REPORT_HALF_LIFE_DAYS)).toBeCloseTo(0.25, 5);
    // A future/negative age is clamped, never weighted above a fresh report.
    expect(recencyWeight(-10)).toBe(1);
  });
});

describe("summariseVisitReports floor", () => {
  it("stays hidden under the report floor (no fabricated confidence)", () => {
    const few = [
      report({ visitedAt: daysAgoKey(0), busyness: "steady" }),
      report({ visitedAt: daysAgoKey(1), busyness: "steady" }),
    ];
    expect(few.length).toBeLessThan(MIN_REPORTS_TO_SUMMARISE);
    const summary = summariseVisitReports(few, NOW);
    expect(summary.shown).toBe(false);
    expect(summary.headline).toBeNull();
    expect(summary.lines).toEqual([]);
  });

  it("shows an honest headline count once the floor is met", () => {
    const reports = [0, 1, 2].map((n) => report({ visitedAt: daysAgoKey(n), busyness: "steady" }));
    const summary = summariseVisitReports(reports, NOW);
    expect(summary.shown).toBe(true);
    expect(summary.headline).toBe("3 recent visit reports");
  });
});

describe("recency weighting boundaries (fresh outweighs stale)", () => {
  it("a burst of fresh reports overrides a pile of stale opposite ones", () => {
    const reports = [
      // Fresh: rammed, tonight-ish.
      report({ visitedAt: daysAgoKey(0), busyness: "rammed" }),
      report({ visitedAt: daysAgoKey(1), busyness: "rammed" }),
      report({ visitedAt: daysAgoKey(2), busyness: "rammed" }),
      // Stale: quiet, ~4 half-lives ago (weight ~0.06 each).
      report({ visitedAt: daysAgoKey(120), busyness: "quiet" }),
      report({ visitedAt: daysAgoKey(120), busyness: "quiet" }),
      report({ visitedAt: daysAgoKey(120), busyness: "quiet" }),
    ];
    const summary = summariseVisitReports(reports, NOW);
    expect(summary.busyness.top).toBe("rammed");
    expect(summary.lines).toContain("Usually rammed");
    expect(summary.lines).not.toContain("Usually quiet");
  });

  it("flips when the recency is reversed — same rows, opposite ages", () => {
    const reports = [
      report({ visitedAt: daysAgoKey(120), busyness: "rammed" }),
      report({ visitedAt: daysAgoKey(120), busyness: "rammed" }),
      report({ visitedAt: daysAgoKey(120), busyness: "rammed" }),
      report({ visitedAt: daysAgoKey(0), busyness: "quiet" }),
      report({ visitedAt: daysAgoKey(1), busyness: "quiet" }),
      report({ visitedAt: daysAgoKey(2), busyness: "quiet" }),
    ];
    const summary = summariseVisitReports(reports, NOW);
    expect(summary.busyness.top).toBe("quiet");
  });
});

describe("honest lines, never a star score", () => {
  it("renders would-return and price lines from weighted shares", () => {
    const reports = [
      report({ visitedAt: daysAgoKey(0), wouldReturn: "yes", priceSanity: "fine" }),
      report({ visitedAt: daysAgoKey(1), wouldReturn: "yes", priceSanity: "fine" }),
      report({ visitedAt: daysAgoKey(2), wouldReturn: "yes", priceSanity: "steep" }),
    ];
    const summary = summariseVisitReports(reports, NOW);
    expect(summary.lines).toContain("Most would return");
    expect(summary.lines).toContain("Prices felt fair");
    // No star score, no "/5", no average masquerading as a rating anywhere.
    const blob = JSON.stringify(summary).toLowerCase();
    expect(blob).not.toContain("star");
    expect(blob).not.toContain("/5");
    for (const line of summary.lines) expect(line).not.toMatch(/\d/);
  });

  it("suppresses a line whose field is under its own floor", () => {
    // Three reports clear the summary floor, but only ONE carries a price read —
    // so the price line must NOT render on a single tap.
    const reports = [
      report({ visitedAt: daysAgoKey(0), busyness: "steady" }),
      report({ visitedAt: daysAgoKey(1), busyness: "steady" }),
      report({ visitedAt: daysAgoKey(2), busyness: "steady", priceSanity: "steep" }),
    ];
    const summary = summariseVisitReports(reports, NOW);
    expect(summary.lines).toContain("Usually steady");
    expect(summary.lines.some((l) => l.includes("Prices"))).toBe(false);
    expect(summary.lines.some((l) => l.includes("Split on price"))).toBe(false);
  });
});
