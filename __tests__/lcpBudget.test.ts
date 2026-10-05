// LCP is budgeted like everything else a route may spend.
//
// The file already held the three LEVERS - server render, decoded JS, requests -
// and a route can hold all three and still paint late. U1 of
// docs/plans/SITE_SPEED_2026-09-01.md adds the figure a drinker actually feels
// to the same sweep, under the same method block, so the four numbers describe
// one load rather than four.
//
// KTD-2 is the law this file guards hardest: ceilings only ratchet DOWN.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BUDGET_METRICS,
  BUDGET_METRIC_LABELS,
  PERFORMANCE_BUDGETS,
  findBudgetBreaches,
  findRatchetCandidates,
  formatRatchetTable,
  type RouteMeasurement,
} from "@/lib/performanceBudgets";
import { defined } from "@/__tests__/helpers/defined";

/** The programme's target for the front door and its one primary action. */
const FRONT_DOOR_CEILING_MS = 1500;
/** The Core Web Vitals good boundary: no route may be worse than good. */
const GOOD_LCP_MS = 2500;

describe("lcpMs is a budgeted metric", () => {
  it("rides the same list as the levers, so one sweep measures all four", () => {
    expect(BUDGET_METRICS).toContain("lcpMs");
    expect(BUDGET_METRIC_LABELS.lcpMs).toBe("LCP (ms)");
  });

  // A ROUTE THAT ANSWERS A REDIRECT PAINTS NOTHING, AND ZERO IS THE HONEST
  // CEILING FOR IT.
  //
  // The sweep measures such a route through the redirect rather than the page
  // it lands on (lib/performanceBudgets.ts, `redirectsTo`), so there is no
  // largest contentful paint to hold to a number. Demanding one would force the
  // row to carry a ceiling belonging to somebody else's page, which is the
  // defect that lane exists to close.
  //
  // The exemption is NARROW and it is not a way out: a redirect row must read
  // exactly 0, not merely "not positive", and every other row still owes a real
  // ceiling.
  it("is a positive ceiling on every route that paints, and exactly zero on one that does not", () => {
    for (const route of PERFORMANCE_BUDGETS.routes) {
      expect(Number.isInteger(route.lcpMs), route.path).toBe(true);
      if (route.redirectsTo) {
        expect(route.lcpMs, `${route.path} redirects, so it paints nothing`).toBe(0);
        continue;
      }
      expect(route.lcpMs, route.path).toBeGreaterThan(0);
    }
  });

  it("keeps the rule strict for a route that draws a page", () => {
    // The exemption reads `redirectsTo`, never the figure, so a page row that
    // arrived carrying 0 is still a row with no ceiling.
    const pageRow = PERFORMANCE_BUDGETS.routes.find((route) => !route.redirectsTo);
    expect(pageRow?.lcpMs).toBeGreaterThan(0);
    expect(
      PERFORMANCE_BUDGETS.routes.filter((route) => !route.redirectsTo && route.lcpMs <= 0),
    ).toEqual([]);
  });

  it("passes a redirect that costs what a redirect costs", () => {
    // Zero measured against a zero ceiling is not a breach: `findBudgetBreaches`
    // only reports a figure PAST its ceiling, so a metric a redirect cannot
    // spend stays quiet rather than reading as an unmeasured route.
    const redirecting = PERFORMANCE_BUDGETS.routes.filter((route) => route.redirectsTo);
    expect(redirecting.length).toBeGreaterThan(0);
    for (const route of redirecting) {
      const measured = new Map<string, RouteMeasurement>([
        [route.path, { serverRenderMs: 5, jsDecodedKB: 0, requests: 1, lcpMs: 0 }],
      ]);
      expect(findBudgetBreaches([route], measured), route.path).toEqual([]);
    }
  });

  it("still asks the ratchet to bank the slack a redirect leaves behind", () => {
    // /onboarding keeps the serverRenderMs ceiling it had as a page, because
    // this rig has never measured what the 307 costs on the CI runner and this
    // file's own law is that a ceiling comes down on a MEASUREMENT rather than
    // on a guess. So the sweep names it as slack to bank, which is the warning
    // doing its job, and the next sweep is the oracle that lowers it.
    const onboarding = PERFORMANCE_BUDGETS.routes.find((route) => route.path === "/onboarding");
    const measured = new Map<string, RouteMeasurement>([
      ["/onboarding", { serverRenderMs: 5, jsDecodedKB: 0, requests: 1, lcpMs: 0 }],
    ]);
    const candidates = findRatchetCandidates([onboarding!], measured);
    expect(candidates.map((candidate) => candidate.metric)).toEqual(["serverRenderMs"]);
    // The metrics a redirect genuinely cannot spend are never named, because
    // both readers refuse a zero ceiling rather than dividing by it.
    expect(candidates.map((candidate) => candidate.metric)).not.toContain("lcpMs");
    expect(candidates.map((candidate) => candidate.metric)).not.toContain("jsDecodedKB");
  });

  it("fails a route that paints past its ceiling", () => {
    const route = defined(PERFORMANCE_BUDGETS.routes[0]);
    const measured = new Map<string, RouteMeasurement>([
      [
        route.path,
        {
          serverRenderMs: 1,
          jsDecodedKB: 1,
          requests: 1,
          lcpMs: route.lcpMs + 1,
        },
      ],
    ]);
    const breaches = findBudgetBreaches([defined(route)], measured);
    expect(breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
  });

  it("passes a route that paints exactly on its ceiling", () => {
    const route = defined(PERFORMANCE_BUDGETS.routes[0]);
    const measured = new Map<string, RouteMeasurement>([
      [
        route.path,
        {
          serverRenderMs: 1,
          jsDecodedKB: 1,
          requests: 1,
          lcpMs: route.lcpMs,
        },
      ],
    ]);
    expect(findBudgetBreaches([defined(route)], measured)).toEqual([]);
  });
});

describe("the seeded ceilings say what they mean", () => {
  const byPath = new Map(
    PERFORMANCE_BUDGETS.routes.map((route) => [route.path, route]),
  );

  it("holds the front door and its primary action to the programme target", () => {
    // At or BELOW, not exactly at. The target is a ceiling the two most
    // important routes may never be worse than; pinning the literal 1500
    // forbade the ratchet this file exists to encourage, and / now sits at 800
    // because it was measured there.
    expect(byPath.get("/")?.lcpMs).toBeLessThanOrEqual(FRONT_DOOR_CEILING_MS);
    expect(byPath.get("/pal")?.lcpMs).toBeLessThanOrEqual(FRONT_DOOR_CEILING_MS);
  });

  it("lets no route be worse than the good boundary", () => {
    for (const route of PERFORMANCE_BUDGETS.routes) {
      expect(route.lcpMs, route.path).toBeLessThanOrEqual(GOOD_LCP_MS);
    }
  });

  it("records where the seed came from, so the next reader can ratchet it", () => {
    // A DATE, not one particular date. Pinning the literal day made this fail on
    // every legitimate re-seed, which is the opposite of what it is for: the
    // note has to say when the figures were taken so the next reader knows how
    // old they are, and a re-seed is the healthy case.
    expect(PERFORMANCE_BUDGETS.note).toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    expect(PERFORMANCE_BUDGETS.note).toMatch(/down is free, up is a decision/);
    // The throttle is a fact about the METHOD and it is asserted where it
    // lives, so restating it in the prose is not what keeps it true.
    expect(PERFORMANCE_BUDGETS.method.cpuThrottleRate).toBe(4);
  });
});

describe("/pal is budgeted at all", () => {
  const pal = PERFORMANCE_BUDGETS.routes.find((route) => route.path === "/pal");

  it("is measured beside the landing that sends people to it", () => {
    expect(pal, "/pal is a budgeted route").toBeTruthy();
    expect(pal?.readySelector).toBe(".palExperience");
    expect(pal?.settledSelectorHidden).toBe(".palLoading");
  });

  it("carries every metric, so nothing about it is unmeasured", () => {
    for (const metric of BUDGET_METRICS) {
      expect(pal?.[metric], metric).toBeGreaterThan(0);
    }
  });
});

// U8 of docs/plans/SITE_SPEED_2026-09-01.md: slack does not stay slack.
//
// #1296 is the record of what happens without this. A ceiling is set
// generously, the route quietly grows back into it, and nobody can say when.
// A sweep that beats a ceiling by a clear margin now NAMES the candidate, so
// the margin is banked as a lower number instead of spent.
//
// It is a warning and only a warning: it edits no file and fails no build. A
// ceiling comes down because a person decided it should, with the measurement
// in front of them.
describe("the ratchet warning", () => {
  const route = defined(PERFORMANCE_BUDGETS.routes[0]);

  function measurement(over: Partial<RouteMeasurement> = {}): RouteMeasurement {
    return {
      serverRenderMs: route.serverRenderMs,
      jsDecodedKB: route.jsDecodedKB,
      requests: route.requests,
      lcpMs: route.lcpMs,
      ...over,
    };
  }

  it("stays quiet when every ceiling is snug", () => {
    const measured = new Map([[route.path, measurement()]]);
    expect(findRatchetCandidates([defined(route)], measured)).toEqual([]);
    expect(formatRatchetTable([])).toBe("");
  });

  it("names a metric beaten by more than the slack fraction", () => {
    const measured = new Map([
      [route.path, measurement({ lcpMs: Math.round(route.lcpMs * 0.5) })],
    ]);
    const candidates = findRatchetCandidates([defined(route)], measured);
    expect(candidates.map((candidate) => candidate.metric)).toEqual(["lcpMs"]);
    expect(defined(candidates[0]).underBy).toBeGreaterThanOrEqual(15);
    expect(formatRatchetTable(candidates)).toContain(route.path);
  });

  it("leaves a metric just inside the fraction alone", () => {
    // 10% under is not worth a decision; 15% is the line.
    const measured = new Map([
      [route.path, measurement({ lcpMs: Math.round(route.lcpMs * 0.9) })],
    ]);
    expect(findRatchetCandidates([defined(route)], measured)).toEqual([]);
  });

  it("never treats an unmeasured route as slack", () => {
    // That route is a BREACH, and findBudgetBreaches already says so.
    expect(findRatchetCandidates([defined(route)], new Map())).toEqual([]);
    expect(findBudgetBreaches([defined(route)], new Map()).length).toBeGreaterThan(0);
  });

  it("banks nothing on its own: no writer touches the budget file", () => {
    const source = readFileSync(
      join(__dirname, "..", "lib/performanceBudgets.ts"),
      "utf8",
    );
    // Reading the ceilings is the module's whole job; WRITING them is what a
    // warning must never do.
    expect(source).not.toMatch(/writeFile|appendFile|node:fs/);
  });
});
