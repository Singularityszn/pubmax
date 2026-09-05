import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { median } from "../lib/performanceBudgets";
import {
  CWV_BASELINE,
  REQUIRED_BASELINE_ROUTES,
  findProductTimingRegressions,
  findVitalsRegressions,
  formatBaselineTable,
  formatProductTimingTable,
  formatRegressionTable,
  productTimingKey,
  vitalsRecordKey,
  type MeasuredVitals,
  type ProductTimingRecord,
  type VitalsDevice,
  type VitalsRecord,
  type VitalsTemperature,
} from "../lib/webVitalsBaseline";
import {
  PRIMARY_INTERACTIONS,
  PRODUCT_TIMING_CEILING_MS,
  VITALS_DEVICES,
  applyVitalsDevice,
  coolBrowser,
  exercisePrimaryAction,
  installVitalsProbe,
  readVitals,
  SHIPPED_MAP_INIT_SCRIPT,
  serveMapInitScript,
  timeMapUsableVenues,
  timePlanEditable,
  timeVenueSheet,
} from "./helpers/webVitals";

/**
 * The product's Core Web Vitals sweep: the recorded baseline, and the fence.
 *
 * The audit's R2 found that no numeric speed rating existed for the product.
 * perf/route-budgets.json holds page COSTS on one phone; nothing held LCP, INP
 * or CLS across devices, nothing held a cold visit apart from a warm one, and
 * nothing at all held the four moments the product becomes usable. This spec is
 * the measuring half of that answer; lib/webVitalsBaseline.ts is the rules half
 * and is unit-tested with no browser.
 *
 * TWO MODES, one method:
 *
 *   PUBMAX_CWV_RECORD=1 writes perf/cwv-baseline.json from this run. It is how
 *     a baseline is taken and re-taken, and it asserts nothing, because a run
 *     that both sets the number and checks it checks nothing.
 *   PUBMAX_CWV_SWEEP=1 measures the same way and FAILS on any figure worse than
 *     the recorded one by more than lib/webVitalsBaseline.ts's tolerance.
 *
 * Neither runs in the ordinary browser suite: a full sweep is five runs across
 * six routes, two devices and two cache temperatures under a CPU throttle,
 * which is an hour of wall clock. GitHub Actions is off by the captain's
 * decision, so no job runs this: `npm run perf:cwv-sweep` is the fence and it
 * is spent by hand, before a merge that could move a figure. AGENTS.md's speed
 * entry says the same thing in the same words.
 *
 * WHY A REAL WEBGL CONTEXT. Two of the six routes are the map, and the product
 * timing that matters most on this whole list is the first pin a thumb can land
 * on. Without SwiftShader the canvas never gets a context, the map takes its
 * honest fallback, and the sweep would report the fallback's speed as the
 * product's. The project that owns this spec supplies the flags.
 */

const RECORD = !!process.env.PUBMAX_CWV_RECORD;
const SWEEP = !!process.env.PUBMAX_CWV_SWEEP;
const RUNS = Number(process.env.PUBMAX_CWV_RUNS ?? 5);
/**
 * Which copy of the map's cold-open init script this run measures.
 *
 * This is how the "before" half of a before-and-after table is taken without
 * reverting the working tree: the shipped script stays committed and the arm is
 * chosen at the wire. It names a file, so a run says in its own command line
 * which arm it measured, and it DEFAULTS to the shipped one rather than to no
 * interception at all - see serveMapInitScript for why an un-intercepted arm is
 * not comparable to an intercepted one.
 */
const MAP_INIT_SCRIPT = process.env.PUBMAX_CWV_LEGACY_MAP_INIT?.trim() || SHIPPED_MAP_INIT_SCRIPT;
const DEVICES: VitalsDevice[] = (process.env.PUBMAX_CWV_DEVICES ?? "mobile,desktop")
  .split(",")
  .map((value) => value.trim())
  .filter((value): value is VitalsDevice => value === "mobile" || value === "desktop");

/** How the route is proved to have arrived before its vitals are read. */
const ROUTE_READY: Record<string, string> = {
  "/": "main",
  "/tonight": "main",
  "/today": "main",
  "/plan": "main.planPage",
  "/map": ".mapShell, .mobileMapShell, main",
  "/map?sel=venue-1vle947": ".venueInspector",
};

const ROUTE_READY_TIMEOUT_MS = 180_000;

/**
 * The venue the sel-variant opens.
 *
 * Named once here because it appears in the route path, in the product timing
 * and in perf/route-budgets.json, and three copies of one id is three chances
 * for a sweep to measure a pub that is not the pub the baseline recorded.
 */
const SELECTED_VENUE_PATH = "/map?sel=venue-1vle947";

type Sample = MeasuredVitals & {
  /**
   * Whether the route's primary action was actually exercised.
   *
   * A control that never appeared leaves the probe with no interaction to
   * report, and INP then reads at the floor - which puts the route at the TOP
   * of the table as the most responsive thing on the site. That failure is
   * silent and flattering, which is the worst combination a measurement can
   * have, so it is carried per sample and failed on below.
   */
  interacted: boolean;
};

async function loadAndSettle(page: Page, routePath: string): Promise<void> {
  await page.goto(routePath, { waitUntil: "load" });
  const ready = ROUTE_READY[routePath] ?? "main";
  await expect(page.locator(ready).first()).toBeVisible({ timeout: ROUTE_READY_TIMEOUT_MS });
  // LCP is only final once the page stops producing candidates. A short settle
  // after the readiness gate costs a second and stops a late hero being
  // recorded as though it never arrived.
  await page.waitForTimeout(1_000);
}

/** One measured load: cold or warm, then the route's own primary interaction. */
async function sampleRoute(
  page: Page,
  routePath: string,
  temperature: VitalsTemperature,
): Promise<Sample> {
  if (temperature === "cold") {
    await coolBrowser(page);
  } else {
    // Warm means the browser has already had this route once. The priming load
    // is not measured; it is what fills the cache the measured load reads.
    await loadAndSettle(page, routePath);
  }
  await loadAndSettle(page, routePath);
  const interacted = await exercisePrimaryAction(page, routePath);
  return { ...(await readVitals(page)), interacted };
}

function aggregate(samples: readonly Sample[]): MeasuredVitals {
  return {
    lcpMs: median(samples.map((sample) => sample.lcpMs)),
    inpMs: median(samples.map((sample) => sample.inpMs)),
    cls: median(samples.map((sample) => sample.cls)),
  };
}

/**
 * The one interaction the sweep cannot suppress: a save that must really be
 * written, because the number is the acknowledgement rather than the tap.
 *
 * It runs on the keyless build's own in-memory plan store, so no account and no
 * durable row is involved, and the clock starts on the tap rather than on
 * navigation: everything before it is the /plan editable timing, already
 * recorded separately, and adding the two together would report neither.
 */
async function timeAcknowledgedSave(page: Page): Promise<number> {
  await page.goto("/plan", { waitUntil: "load" });
  const query = page.locator("#plan-describe-first-query");
  await expect(query).toBeEditable({ timeout: PRODUCT_TIMING_CEILING_MS });
  await query.fill("quiet in Clapham, not pricey");

  // A control painted on the SERVER is tappable before React attaches, so
  // Playwright's actionability check passes and the tap is dropped with nothing
  // on screen saying so. The route then never posts and the wait spends its
  // whole budget reporting an absence that was really a dropped tap. The house
  // idiom is to retry the TAP rather than to assert harder on what follows it
  // (AGENTS.md; e2e/plan-single-stop.spec.ts).
  await expect(async () => {
    await page.getByRole("button", { name: "Sort it", exact: true }).click();
    await expect(page.locator(".planComposer__stop").first()).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: PRODUCT_TIMING_CEILING_MS });

  const nameField = page.getByLabel("Your name");
  if (await nameField.count()) await nameField.fill("Perf baseline");

  // The clock starts on the tap that asks for the save, and the save is latched
  // in the app, so a retried tap cannot mint a second plan.
  const lockIn = page.getByRole("button", { name: "Lock it in" });
  await expect(lockIn).toBeEnabled({ timeout: PRODUCT_TIMING_CEILING_MS });
  const startedAt = Date.now();
  await expect(async () => {
    await lockIn.click();
    await page.waitForURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/, { timeout: 20_000 });
  }).toPass({ timeout: PRODUCT_TIMING_CEILING_MS });
  await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible({
    timeout: PRODUCT_TIMING_CEILING_MS,
  });
  return Date.now() - startedAt;
}

test.describe("Core Web Vitals baseline", () => {
  test.skip(!RECORD && !SWEEP, "Spent by hand: npm run perf:cwv-sweep or perf:cwv-record.");
  // Six routes, two temperatures, five runs, under a CPU throttle. It is one
  // test because one page and one cache is the only way cold really means cold.
  test.setTimeout(3 * 60 * 60_000);

  test("records or defends every route's LCP, INP, CLS and the product timings", async ({
    page,
  }, testInfo) => {
    await installVitalsProbe(page);
    await serveMapInitScript(page, MAP_INIT_SCRIPT);
    console.log(`[cwv] map cold-open script served from ${MAP_INIT_SCRIPT}`);

    const routeRecords: VitalsRecord[] = [];
    const measuredVitals = new Map<string, MeasuredVitals>();
    /** Rows whose primary action never appeared, so their INP means nothing. */
    const uninteracted: string[] = [];

    for (const device of DEVICES) {
      await applyVitalsDevice(page, device);
      for (const routePath of REQUIRED_BASELINE_ROUTES) {
        for (const temperature of ["cold", "warm"] as const) {
          const samples: Sample[] = [];
          for (let run = 0; run < RUNS; run += 1) {
            samples.push(await sampleRoute(page, routePath, temperature));
          }
          const figures = aggregate(samples);
          const key = vitalsRecordKey(routePath, device, temperature);
          if (!samples.some((sample) => sample.interacted)) uninteracted.push(key);
          measuredVitals.set(key, figures);
          routeRecords.push({ path: routePath, device, temperature, ...figures });
          console.log(
            `[cwv] ${key.padEnd(34)} LCP ${Math.round(figures.lcpMs).toString().padStart(6)}` +
              `  INP ${Math.round(figures.inpMs).toString().padStart(5)}` +
              `  CLS ${figures.cls.toFixed(3)}` +
              `   LCP samples ${samples.map((sample) => Math.round(sample.lcpMs)).join("/")}`,
          );
        }
      }
    }

    const productRecords: ProductTimingRecord[] = [];
    const measuredTimings = new Map<string, number>();

    for (const device of DEVICES) {
      await applyVitalsDevice(page, device);

      const collect = async (
        key: string,
        label: string,
        startedAt: string,
        take: () => Promise<number>,
      ) => {
        const runs: number[] = [];
        for (let run = 0; run < RUNS; run += 1) {
          await coolBrowser(page);
          runs.push(await take());
        }
        const ms = median(runs);
        measuredTimings.set(productTimingKey(key, device), ms);
        productRecords.push({ key, label, device, startedAt, ms });
        console.log(
          `[cwv][product] ${productTimingKey(key, device).padEnd(34)} ` +
            `${Math.round(ms).toString().padStart(7)} ms   runs ${runs
              .map((value) => Math.round(value))
              .join("/")}`,
        );
      };

      await collect(
        "map-usable-venues",
        "usable venue results on /map (first painted pin)",
        "navigation start",
        () => timeMapUsableVenues(page),
      );
      await collect(
        "map-venue-sheet",
        "a selected venue sheet (/map?sel=)",
        "navigation start",
        () => timeVenueSheet(page, SELECTED_VENUE_PATH),
      );
      await collect("plan-editable", "an editable plan on /plan", "navigation start", () =>
        timePlanEditable(page),
      );
      await collect(
        "plan-acknowledged-save",
        "an acknowledged save (Lock it in to the saved plan)",
        "the Lock it in tap",
        () => timeAcknowledgedSave(page),
      );
    }

    // A row whose control never appeared records the floor and reads as the
    // fastest thing on the table, so it fails before any number is written or
    // defended.
    expect(
      uninteracted,
      "The primary action never appeared on these rows, so their INP is the " +
        `Event Timing floor rather than a measurement: ${uninteracted.join(", ")}`,
    ).toEqual([]);

    console.log(`\n[cwv] routes\n${formatBaselineTable(routeRecords)}`);
    console.log(`\n[cwv] product timings\n${formatProductTimingTable(productRecords)}`);

    // The run's own tables, kept as an artifact whichever mode it ran in, so a
    // re-measurement can be pasted into a PR without re-reading a log.
    await mkdir(testInfo.outputDir, { recursive: true });
    const artifact = path.join(testInfo.outputDir, "cwv-run.json");
    await writeFile(
      artifact,
      `${JSON.stringify({ routes: routeRecords, productTimings: productRecords }, null, 2)}\n`,
      "utf8",
    );

    if (RECORD) {
      const target = path.join(process.cwd(), "perf", "cwv-baseline.json");
      await writeFile(
        target,
        `${JSON.stringify(
          {
            note: CWV_BASELINE.note,
            method: {
              ...CWV_BASELINE.method,
              runs: RUNS,
              devices: Object.fromEntries(
                DEVICES.map((device) => [
                  device,
                  {
                    viewport: VITALS_DEVICES[device].viewport,
                    cpuThrottleRate: VITALS_DEVICES[device].cpuThrottleRate,
                    network: VITALS_DEVICES[device].network.label,
                  },
                ]),
              ),
            },
            routes: routeRecords,
            productTimings: productRecords,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      console.log(`[cwv] wrote ${target}. Add a debt reason to any row over its R2 target.`);
      return;
    }

    const regressions = [
      ...findVitalsRegressions(CWV_BASELINE.routes, measuredVitals),
      ...findProductTimingRegressions(CWV_BASELINE.productTimings, measuredTimings),
    ];
    expect(
      regressions,
      regressions.length === 0
        ? "no regression"
        : "Slower than the recorded baseline. Fix the route, or re-record with " +
          "PUBMAX_CWV_RECORD=1 and say in the same commit what got slower and why " +
          `(docs/perf/baseline-2026-09-05.md).\n\n${formatRegressionTable(regressions)}\n`,
    ).toEqual([]);
  });

  test("every measured route names a primary action to interact with", async () => {
    // A route with no interaction records INP at the floor for ever, which
    // reads as the fastest route on the table. The table is the whole point, so
    // the gap is a failure rather than a silent 16 ms.
    const missing = REQUIRED_BASELINE_ROUTES.filter(
      (routePath) => !PRIMARY_INTERACTIONS[routePath],
    );
    expect(missing, `No primary interaction for: ${missing.join(", ")}`).toEqual([]);
  });
});
