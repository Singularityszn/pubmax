import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test } from "@playwright/test";

import { PERF_AB_BREACH_FILE, abHandoverForBreaches } from "../lib/performanceAbEvidence";
import {
  PERFORMANCE_BUDGETS,
  findBudgetBreaches,
  findMethodWarnings,
  findRatchetCandidates,
  formatBreachTable,
  formatMeasurementTable,
  formatRatchetTable,
  formatSampleTable,
  plannedNavigations,
  type RouteMeasurement,
  type SampleRow,
} from "../lib/performanceBudgets";
import { measurePerfRedirect, preparePerfPage, runPerfRoute } from "./helpers/perfMeasurement";

// The enforced site performance budget (docs/PERFORMANCE_BUDGETS.md).
//
// One spec measures every budgeted route against perf/route-budgets.json and
// fails with an over-budget table naming what went past which ceiling. It runs
// against the production build Playwright's webServer already builds, because
// a dev-server measurement would be a number about webpack rather than about
// what a drinker downloads.
//
// WHAT IS MEASURED, and why each is the honest proxy:
//   serverRenderMs — responseStart minus requestStart on the document's own
//     navigation entry. Over loopback that is server think time with no network
//     in it, which is the part of a production TTFB the code owns.
//   jsDecodedKB — decoded (so: parse cost, not transfer cost) bytes of every
//     same-origin script the route asked for before it was interactive.
//   requests — how many same-origin requests it took to get there. A route can
//     hold its bytes and still lose the night to a waterfall.
//   lcpMs — the largest contentful paint the same run observed. The three above
//     are levers; this is the one a drinker feels, and a route can hold every
//     lever and still paint late.
//
// HOW it is measured is e2e/helpers/perfMeasurement.ts, shared with the UX lane
// report so the two sets of figures are taken the same way and stay comparable.
//
// Gated on PUBMAX_PERF_BUDGET so the ordinary browser suite does not pay for
// it; the CI job that owns it sets the variable.

const budgets = PERFORMANCE_BUDGETS;

// THIS SWEEP IS NEVER RETRIED, AND THAT IS THE GATE.
//
// playwright.config.ts retries once on CI, which is right for a browser test
// that raced something. It is wrong for a measurement: Playwright calls a test
// that fails then passes FLAKY, and a flaky run exits 0. On 6 September 2026 the
// push run for main's own head measured /pubs at 1275 KB against a 1200 ceiling
// and 73 requests against 68, printed the breach table, retried, measured under
// the ceiling the second time and reported the job GREEN, while every pull
// request carrying the same numbers went red. A breach that a coin flip can
// launder into "flaky" is not a ceiling.
//
// The method already owns the noise this would paper over: warmup runs, several
// measured runs, the median, and a spread warning when the samples sat further
// apart than the tracked width. Re-running the whole sweep is not a second
// opinion, it is a second draw.
test.describe.configure({ retries: 0 });

// The whole sweep in one test: the server is shared, so the routes must be
// measured one after another rather than raced by parallel workers.
//
// The budget is derived from the WORST CASE rather than from the routes alone,
// because a route can spend a resample budget and a route marked noisy spends a
// wider one: a timeout that did not count them would turn a route measuring
// itself properly into a sweep that timed out, and an unmeasured route is
// already reported as a breach of every metric.
const SWEEP_TIMEOUT_MS = 60_000 * plannedNavigations(budgets.routes, budgets.method);

test("every budgeted route stays inside its performance budget", async ({ page, baseURL }) => {
  test.skip(!process.env.PUBMAX_PERF_BUDGET, "Owned by the performance-budget CI job.");
  test.setTimeout(SWEEP_TIMEOUT_MS);

  const origin = new URL(baseURL ?? "http://localhost:3100").origin;
  await preparePerfPage(page, origin, budgets.method);

  const measured = new Map<string, RouteMeasurement>();
  const samplesByPath = new Map<string, SampleRow[]>();
  for (const route of budgets.routes) {
    // A route that ANSWERS A REDIRECT is measured as one. `page.goto` follows a
    // 3xx, so measuring it as a page reports the cost of whatever it lands on
    // under a ceiling written for the page it used to be, and neither reading
    // of that number is true (lib/performanceBudgets.ts, `redirectsTo`).
    let run;
    if (route.redirectsTo) {
      const sample = await measurePerfRedirect(page, {
        ...route,
        redirectsTo: route.redirectsTo,
      });
      run = { samples: [sample], aggregate: sample };
    } else {
      run = await runPerfRoute(page, route, budgets.method);
    }
    measured.set(route.path, {
      serverRenderMs: run.aggregate.serverRenderMs,
      jsDecodedKB: run.aggregate.jsDecodedKB,
      requests: run.aggregate.requests,
      lcpMs: Math.round(run.aggregate.lcpMs),
    });
    samplesByPath.set(
      route.path,
      run.samples.map((sample) => ({
        serverRenderMs: sample.serverRenderMs,
        jsDecodedKB: sample.jsDecodedKB,
        requests: sample.requests,
        lcpMs: Math.round(sample.lcpMs),
        boundarySource: sample.boundarySource,
        stillOpen: sample.stillOpen,
      })),
    );
  }

  console.log(`[perf-budget]\n${formatMeasurementTable(budgets.routes, measured)}`);

  // Every sample beside its median. A red run is only actionable if an author
  // can see whether the route moved or the runner did (#1314).
  console.log(`\n[perf-budget][samples]\n${formatSampleTable(samplesByPath)}`);

  // Facts about the METHOD rather than about the code under test: a route whose
  // samples sat further apart than the tracked width, and any sample that had
  // to fall back to the harness clock. Reported, never failed on.
  const methodWarnings = findMethodWarnings(samplesByPath, budgets.method.sampleSpreadWarnPct);
  if (methodWarnings.length > 0) {
    console.log(
      `\n[perf-budget][method] the measurement, not the code:\n` +
        `${methodWarnings.map((warning) => `  - ${warning}`).join("\n")}\n`,
    );
  }

  // Slack does not stay slack (#1296): a ceiling set generously is a ceiling a
  // route quietly grows back into. A sweep that beats one by a clear margin
  // names the candidate here so the margin gets banked as a lower number rather
  // than spent. It is a WARNING - it edits nothing and fails nothing.
  const ratchet = findRatchetCandidates(budgets.routes, measured);
  if (ratchet.length > 0) {
    console.log(
      `\n[perf-budget][ratchet] ceilings with slack to bank ` +
        `(docs/PERFORMANCE_BUDGETS.md: down is free, up is a decision):\n` +
        `${formatRatchetTable(ratchet)}\n`,
    );
  }

  const breaches = findBudgetBreaches(budgets.routes, measured);

  // THE BREACH LIST IS HANDED ON, AND IT IS STILL THE GATE.
  //
  // A breach fails this test exactly as it did before. What the file adds is
  // the second question an author asks the moment a route goes red: did this
  // branch make it slower, or is this box slower than the one that set the
  // ceiling? The job's next step re-measures ONLY these routes against the
  // merge-base build, on this same box, and prints the answer
  // (scripts/perf-ab.mjs, e2e/performance-budget-ab.spec.ts).
  //
  // Nothing is written on a green sweep, so the A/B finds no work, never
  // builds the second tree and costs nothing.
  const handover = abHandoverForBreaches(breaches, process.env.GITHUB_SHA ?? "");
  if (handover) {
    mkdirSync(dirname(PERF_AB_BREACH_FILE), { recursive: true });
    writeFileSync(PERF_AB_BREACH_FILE, `${JSON.stringify(handover, null, 2)}\n`);
  }

  expect(
    breaches,
    breaches.length === 0
      ? "no breach"
      : `Over the performance budget. Fix the route or take the ceiling up deliberately (docs/PERFORMANCE_BUDGETS.md).\n\n${formatBreachTable(breaches)}\n`,
  ).toEqual([]);
});
