/**
 * UX lane 13: LCP, CLS and decoded JS at 390x844 against perf/route-budgets.json.
 *
 * Gated on PUBMAX_PERF_BUDGET and owned by the ux-lane-performance CI job
 * (.github/workflows/ci.yml), so the markdown table for the PR body really is
 * produced by a run. It is a JOB OF ITS OWN rather than a second file in the
 * performance-budget step: both sweeps build and serve the app themselves, and
 * this route set's map load runs 10 to 25 seconds cold.
 *
 * It measures through e2e/helpers/perfMeasurement.ts - the SAME warm-up, median
 * runs, CPU throttle, third-party block and app-defined interactive cut the
 * tracked budget spec uses - because a figure compared against a ceiling has to
 * have been taken the way that ceiling was. It reports LCP and CLS for the PR
 * and fails only when JS decoded exceeds its budget by more than 10%.
 */
import { expect, test } from "@playwright/test";

import { PERFORMANCE_BUDGETS } from "../lib/performanceBudgets";
import { measurePerfRoute, preparePerfPage, type PerfRoute } from "./helpers/perfMeasurement";

type UxLaneRoute = PerfRoute & {
  /**
   * Route path in perf/route-budgets.json used for the JS ceiling comparison,
   * or null for a route that carries no tracked ceiling.
   */
  budgetPath: string | null;
  /** Stated when the ceiling belongs to a different document than the one loaded. */
  budgetNote?: string;
};

const UX_LANE_ROUTES: UxLaneRoute[] = [
  { path: "/", readySelector: "main", budgetPath: "/" },
  { path: "/near?patch=soho", readySelector: ".nmn", budgetPath: null },
  {
    path: "/map/london",
    readySelector: ".mobileMapTopbar",
    settledSelectorHidden: ".mapLoading",
    budgetPath: "/map",
    budgetNote:
      "ceiling belongs to /map, the CDN-cached document; /map/london renders per request",
  },
  { path: "/out", readySelector: "main", budgetPath: "/out" },
];

const REGRESSION_TOLERANCE = 1.1;

const method = PERFORMANCE_BUDGETS.method;

const SWEEP_TIMEOUT_MS =
  60_000 * UX_LANE_ROUTES.length * (method.warmupRuns + method.measuredRuns);

function budgetForPath(path: string | null): number | null {
  if (!path) return null;
  const route = PERFORMANCE_BUDGETS.routes.find((entry) => entry.path === path);
  return route?.jsDecodedKB ?? null;
}

test("UX lane routes report LCP, CLS and JS decoded against route budgets", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(!process.env.PUBMAX_PERF_BUDGET, "Owned by the performance-budget CI job.");
  test.setTimeout(SWEEP_TIMEOUT_MS);

  const origin = new URL(baseURL ?? "http://localhost:3100").origin;
  await preparePerfPage(page, origin, method);

  const rows: string[] = [];
  const notes: string[] = [];
  const regressions: string[] = [];

  for (const route of UX_LANE_ROUTES) {
    const { lcpMs, cls, jsDecodedKB } = await measurePerfRoute(page, route, method);
    const budgetKb = budgetForPath(route.budgetPath);
    const overPct =
      budgetKb !== null && jsDecodedKB > budgetKb
        ? Math.round(((jsDecodedKB - budgetKb) / budgetKb) * 100)
        : null;

    if (budgetKb !== null && jsDecodedKB > budgetKb * REGRESSION_TOLERANCE) {
      regressions.push(
        `${route.path}: JS decoded ${jsDecodedKB} KB > budget ${budgetKb} KB (+${overPct}%)`,
      );
    }

    if (route.budgetNote) notes.push(`- \`${route.path}\`: ${route.budgetNote}.`);

    rows.push(
      `| ${route.path} | ${Math.round(lcpMs)} | ${cls.toFixed(3)} | ${jsDecodedKB} | ${
        budgetKb ?? "n/a"
      } | ${overPct !== null ? `+${overPct}%` : "n/a"} |`,
    );
  }

  const markdown = [
    `## UX lane 13 performance (${method.viewport.width}x${method.viewport.height}, production build)`,
    "",
    `Method: ${method.warmupRuns} warm-up run then the ${method.aggregate} of ${method.measuredRuns}, CPU throttled ${method.cpuThrottleRate}x, cross-origin requests refused. ${method.countedUpTo}`,
    "",
    "| route | LCP (ms) | CLS | JS decoded (KB) | budget (KB) | over budget |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
    ...(notes.length > 0 ? [...notes, ""] : []),
    "LCP and CLS are reported for the PR; JS decoded is compared to perf/route-budgets.json.",
  ].join("\n");

  await testInfo.attach("ux-lane-13-perf.md", {
    body: markdown,
    contentType: "text/markdown",
  });

  expect(regressions, markdown).toEqual([]);
});
