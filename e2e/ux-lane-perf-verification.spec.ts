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
 * and fails only when JS decoded exceeds, by more than 10%, a ceiling measured
 * on the SAME document. A ceiling borrowed from another document is printed as
 * context: /map is prerendered and CDN-cached while /map/london renders per
 * request, so a difference between them is not a regression in either.
 *
 * The table is WRITTEN to the test's own output directory, not only attached:
 * an attachment carrying a body never reaches disk, and this run's whole point
 * is a file the PR body can quote.
 */
import { writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { PERFORMANCE_BUDGETS } from "../lib/performanceBudgets";
import { measurePerfRoute, preparePerfPage, type PerfRoute } from "./helpers/perfMeasurement";

type UxLaneRoute = PerfRoute & {
  /**
   * Route path in perf/route-budgets.json whose ceiling is printed beside this
   * route's figure, or null for a route that carries no tracked ceiling. A
   * ceiling GATES the build only when it belongs to the document that was
   * loaded (`budgetPath === path`); anything else is context for the reader.
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
      "ceiling belongs to /map, the CDN-cached prerendered document, while /map/london renders per request with a nonce. The figure is reported for comparison and does not fail this job",
  },
  { path: "/out", readySelector: "main", budgetPath: "/out" },
];

const REGRESSION_TOLERANCE = 1.1;

/** The PR table's file name, uploaded by the ux-lane-performance CI job. */
const UX_LANE_TABLE_FILE = "ux-lane-13-perf.md";

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
  test.skip(!process.env.PUBMAX_PERF_BUDGET, "Owned by the ux-lane-performance CI job.");
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

    // A ceiling measured on another document is not this document's ceiling:
    // /map is prerendered and CDN-cached, /map/london is rendered per request,
    // so a per-request-only difference is not a JS regression.
    const ceilingGatesThisRoute = route.budgetPath === route.path;
    if (
      ceilingGatesThisRoute
      && budgetKb !== null
      && jsDecodedKB > budgetKb * REGRESSION_TOLERANCE
    ) {
      regressions.push(
        `${route.path}: JS decoded ${jsDecodedKB} KB > budget ${budgetKb} KB (+${overPct}%)`,
      );
    }

    if (route.budgetNote) notes.push(`- \`${route.path}\`: ${route.budgetNote}.`);

    rows.push(
      `| ${route.path} | ${Math.round(lcpMs)} | ${cls.toFixed(3)} | ${jsDecodedKB} | ${
        budgetKb === null
          ? "n/a"
          : `${budgetKb}${ceilingGatesThisRoute ? "" : ` (${route.budgetPath}, reported)`}`
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
    "LCP and CLS are reported for the PR; JS decoded fails this job only against the ceiling measured on that same document.",
  ].join("\n");

  // `attach({ body })` keeps the table in memory and writes no file, and the
  // `list` reporter prints an attachment only inside a failure block, so a green
  // run used to produce the PR table nowhere. Write it first, then attach the
  // written file by path.
  const tablePath = testInfo.outputPath(UX_LANE_TABLE_FILE);
  await writeFile(tablePath, `${markdown}\n`, "utf8");
  await testInfo.attach(UX_LANE_TABLE_FILE, {
    path: tablePath,
    contentType: "text/markdown",
  });

  expect(regressions, markdown).toEqual([]);
});
