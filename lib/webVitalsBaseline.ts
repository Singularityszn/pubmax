// The product's SPEED RATING: one recorded number per route, per device, per
// temperature, and the rule that says when a later run has lost ground.
//
// perf/route-budgets.json already holds four LEVERS (server render, decoded
// bytes, requests, LCP) measured on one emulated phone. It says nothing about
// what a person feels after the paint: whether the first tap answers, whether
// the page moves under a thumb, or how long the product takes to become USABLE
// rather than merely painted. So the audit's R2 asked for a Core Web Vitals
// baseline, and this module is the half of it that can be reasoned about
// without a browser: the targets, the recorded table, and the two questions a
// sweep asks of it.
//
// The two questions are deliberately separate:
//
//   TARGET     - is this figure inside Google's own good threshold (the audit's
//                R2: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1)? A figure outside
//                one is DEBT, named in the baseline record with its reason, and
//                never silently accepted.
//   REGRESSION - is this figure worse than the one we recorded? That is the
//                fence. It fires whatever the target says, because a route that
//                was fast and got slower is a regression even at 400 ms.
//
// The measuring lives in e2e/helpers/webVitals.ts and e2e/cwv-baseline.spec.ts.
// This module is pure and data-only so the rules are unit-tested with no
// browser, the same split perf/route-budgets.json and lib/performanceBudgets.ts
// already use.
//
// docs/perf/baseline-2026-09-05.md is the recorded sweep and the method.

import baselineJson from "@/perf/cwv-baseline.json";

/**
 * The three Core Web Vitals, and the product timings beside them.
 *
 * A vital is about the DOCUMENT. A product timing is about the PRODUCT: the
 * moment a drinker can actually use the thing they opened. A map that painted
 * in 600 ms and has no pins on it for another four seconds is a good LCP and a
 * bad night, so both are recorded and both are fenced.
 */
export const VITAL_METRICS = ["lcpMs", "inpMs", "cls"] as const;
export type VitalMetric = (typeof VITAL_METRICS)[number];

const VITAL_METRIC_LABELS: Record<VitalMetric, string> = {
  lcpMs: "LCP (ms)",
  inpMs: "INP (ms)",
  cls: "CLS",
};

/**
 * The audit's R2 thresholds, at the 75th percentile, and Google's own "good"
 * boundaries. They are a TARGET rather than a ceiling: a route outside one is
 * recorded as debt with its reason, because deleting the measurement is how a
 * slow route stops being slow on paper.
 */
export const CORE_WEB_VITAL_TARGETS: Record<VitalMetric, number> = {
  lcpMs: 2500,
  inpMs: 200,
  cls: 0.1,
};

/**
 * How much worse than the recorded figure a later run may read before the fence
 * calls it a regression.
 *
 * Two numbers per metric, and the LARGER of the two wins, because a percentage
 * alone is meaningless on a small figure and a floor alone is meaningless on a
 * large one. The percentages are wide on purpose: perf/route-budgets.json
 * already records that LCP's spread is BETWEEN runs rather than within them and
 * reached 3.17x one route's own median, so a tight fence here would be a fence
 * against the runner rather than against the code.
 */
const PRODUCT_MS_TOLERANCE = { pct: 0.3, floor: 400 };
const REGRESSION_TOLERANCE: Record<string, { pct: number; floor: number }> = {
  lcpMs: { pct: 0.3, floor: 250 },
  inpMs: { pct: 0.5, floor: 80 },
  cls: { pct: 0.5, floor: 0.03 },
  productMs: PRODUCT_MS_TOLERANCE,
};

/** How a run was taken: which emulated device, and whether the cache was cold. */
export type VitalsDevice = "mobile" | "desktop";
export type VitalsTemperature = "cold" | "warm";

/** One route's recorded figures under one device and one temperature. */
export type VitalsRecord = {
  path: string;
  device: VitalsDevice;
  temperature: VitalsTemperature;
  /** Median over the tracked run count. */
  lcpMs: number;
  inpMs: number;
  cls: number;
  /**
   * Set when a recorded figure sits outside its R2 target. It is the reason
   * the debt is accepted for now, in one sentence, and it is REQUIRED: a figure
   * over target with no reason is an unowned promise.
   */
  debt?: string;
};

/**
 * A product timing: the moment the product became usable, not painted.
 *
 * `startedAt` names what the clock starts on, because "time to a venue sheet"
 * measured from navigation and measured from a tap are different claims.
 */
export type ProductTimingRecord = {
  key: string;
  label: string;
  device: VitalsDevice;
  /** What the clock starts on, in the reader's own words. */
  startedAt: string;
  /** Median milliseconds over the tracked run count. */
  ms: number;
  /** A stated goal for this timing, when the product has one. */
  targetMs?: number;
  debt?: string;
};

type CwvBaselineMethod = {
  recordedOn: string;
  commit: string;
  runs: number;
  aggregate: "median";
  build: string;
  /**
   * What this table holds and what it does not, in one sentence. Required: a
   * partial baseline that does not say it is partial reads as a complete one.
   */
  coverage: string;
  /**
   * The rig each recorded device was measured on. Mobile is required because
   * REQUIRED_BASELINE_DEVICES makes it the complete half; the rest are present
   * only when that device was actually swept, so a run that measured one device
   * cannot describe a rig it never used.
   */
  devices: Partial<Record<VitalsDevice, VitalsDeviceRig>> & { mobile: VitalsDeviceRig };
  inpNote: string;
};

type VitalsDeviceRig = {
  viewport: { width: number; height: number };
  cpuThrottleRate: number;
  network: string;
};

export type CwvBaseline = {
  note: string;
  method: CwvBaselineMethod;
  routes: VitalsRecord[];
  productTimings: ProductTimingRecord[];
};

export const CWV_BASELINE = baselineJson as CwvBaseline;

/**
 * The routes the audit's R2 named. The fence holds the recorded table to this
 * list, because an unrecorded route is one nothing can regress - which is the
 * whole finding the table exists to answer.
 */
export const REQUIRED_BASELINE_ROUTES = [
  "/",
  "/map",
  "/map?sel=venue-4xlgb0",
  "/tonight",
  "/today",
  "/plan",
] as const;

/**
 * The device the FULL route list must be complete on.
 *
 * The audit's R2 is about a phone, and the phone is the rig the whole list
 * finishes on. Desktop is required too, on its own narrower list below, for the
 * reason that list carries.
 *
 * `method.coverage` carries that sentence for a reader, and the unit fence
 * refuses a baseline that leaves it blank.
 */
export const REQUIRED_BASELINE_DEVICES: readonly VitalsDevice[] = ["mobile"];

/**
 * The desktop rows the table must hold, and no more than that.
 *
 * Astra's 6 September audit read a desktop field p75 LCP of 3,686 ms over 27
 * samples (`/map` 3,686 ms, `/pal` 5,904 ms, `/` 3,344 ms) against a recorded
 * table that held ZERO desktop rows, so the product had no figure of its own to
 * hold a regression against. These three are the routes that finding names, and
 * they are the ones recorded here.
 *
 * The list is NARROWER than the mobile one on purpose rather than as a
 * shortcut. A run measures every route on every device it is given, and one
 * sweep of both full lists does not finish inside the spec's own timeout: that
 * is why AGENTS.md recorded that "the desktop `/map` warm cell has never
 * finished here". Recording the three routes the finding names, on a device run
 * of its own, is a figure that exists; requiring six would leave the table at
 * zero again.
 *
 * `/pal` is deliberately absent from the mobile list, because the recorded
 * mobile table predates it and a device's rows are only ever re-taken by a run
 * of that device.
 */
export const REQUIRED_DESKTOP_BASELINE_ROUTES = ["/", "/map", "/pal"] as const;

/** Which routes a sweep measures on each device. */
export const BASELINE_ROUTES_BY_DEVICE: Record<VitalsDevice, readonly string[]> = {
  mobile: REQUIRED_BASELINE_ROUTES,
  desktop: REQUIRED_DESKTOP_BASELINE_ROUTES,
};

/**
 * Every route any device measures.
 *
 * The sweep fails a route whose primary action never appeared, so each route on
 * this list must name one: a route measurable on one device and unnamed there
 * would record the Event Timing floor and read as the fastest thing on the
 * table.
 */
export const MEASURABLE_BASELINE_ROUTES: readonly string[] = Array.from(
  new Set(Object.values(BASELINE_ROUTES_BY_DEVICE).flat()),
);

/**
 * The product timing the baseline may never be without.
 *
 * `/map` becoming usable is the product's own slowest promise and the one the
 * profile in docs/perf/baseline-2026-09-05.md is about, so a table that loses
 * it has lost the thing it was built to defend. The other three are recorded
 * when a run reaches them; this one is required, and the fence says so by name
 * rather than by counting rows.
 */
export const REQUIRED_PRODUCT_TIMINGS = ["map-usable-venues"] as const;

/**
 * The route whose LCP is required, for the same reason.
 *
 * A cold `/map` is the worst LCP on the table and the one a fix would be judged
 * by, so it is named here rather than left to whichever rows a run happened to
 * produce.
 */
export const REQUIRED_LCP_ROUTES = ["/map"] as const;

/** The key one record is addressed by, so a table row cannot be read twice. */
export function vitalsRecordKey(
  path: string,
  device: VitalsDevice,
  temperature: VitalsTemperature,
): string {
  return `${device}:${temperature}:${path}`;
}

export function productTimingKey(key: string, device: VitalsDevice): string {
  return `${device}:${key}`;
}

/** The measured side of a comparison: what a later sweep actually read. */
export type MeasuredVitals = Pick<VitalsRecord, "lcpMs" | "inpMs" | "cls">;

export type VitalsRegression = {
  key: string;
  metric: string;
  label: string;
  baseline: number;
  measured: number;
  allowed: number;
};

/** The one place the allowance is computed, so the fence and its table agree. */
export function regressionCeiling(metric: string, baseline: number): number {
  const tolerance = REGRESSION_TOLERANCE[metric] ?? PRODUCT_MS_TOLERANCE;
  return baseline + Math.max(baseline * tolerance.pct, tolerance.floor);
}

/**
 * Every recorded figure a measured sweep read worse than.
 *
 * A record the sweep did not measure is SKIPPED rather than failed: a sweep may
 * legitimately run a subset (one device, one route) and calling the routes it
 * never opened regressions would make the fence useless at that size. A route
 * MISSING from the baseline is the other way round and is caught by
 * findUnrecordedRoutes.
 */
export function findVitalsRegressions(
  baseline: readonly VitalsRecord[],
  measured: ReadonlyMap<string, MeasuredVitals>,
): VitalsRegression[] {
  const regressions: VitalsRegression[] = [];
  for (const record of baseline) {
    const key = vitalsRecordKey(record.path, record.device, record.temperature);
    const run = measured.get(key);
    if (!run) continue;
    for (const metric of VITAL_METRICS) {
      const allowed = regressionCeiling(metric, record[metric]);
      if (!Number.isFinite(run[metric]) || run[metric] <= allowed) continue;
      regressions.push({
        key,
        metric,
        label: VITAL_METRIC_LABELS[metric],
        baseline: record[metric],
        measured: run[metric],
        allowed,
      });
    }
  }
  return regressions;
}

/** The same question for the product timings. */
export function findProductTimingRegressions(
  baseline: readonly ProductTimingRecord[],
  measured: ReadonlyMap<string, number>,
): VitalsRegression[] {
  const regressions: VitalsRegression[] = [];
  for (const record of baseline) {
    const key = productTimingKey(record.key, record.device);
    const run = measured.get(key);
    if (run === undefined || !Number.isFinite(run)) continue;
    const allowed = regressionCeiling("productMs", record.ms);
    if (run <= allowed) continue;
    regressions.push({
      key,
      metric: "ms",
      label: record.label,
      baseline: record.ms,
      measured: run,
      allowed,
    });
  }
  return regressions;
}

export type TargetBreach = {
  key: string;
  metric: VitalMetric;
  label: string;
  measured: number;
  target: number;
  debt?: string;
};

/**
 * Every recorded figure outside its R2 target.
 *
 * Reported with its own reason attached, so the two readings of one row - "this
 * is over target" and "here is why we are carrying it" - travel together and a
 * reader never has to guess whether the debt was noticed.
 */
export function findTargetBreaches(baseline: readonly VitalsRecord[]): TargetBreach[] {
  const breaches: TargetBreach[] = [];
  for (const record of baseline) {
    for (const metric of VITAL_METRICS) {
      if (record[metric] <= CORE_WEB_VITAL_TARGETS[metric]) continue;
      breaches.push({
        key: vitalsRecordKey(record.path, record.device, record.temperature),
        metric,
        label: VITAL_METRIC_LABELS[metric],
        measured: record[metric],
        target: CORE_WEB_VITAL_TARGETS[metric],
        debt: record.debt,
      });
    }
  }
  return breaches;
}

/**
 * A recorded row over target and carrying no reason.
 *
 * This is the rule that keeps the table honest: a slow figure may be recorded,
 * but it may not be recorded SILENTLY. The unit fence fails on this, so a sweep
 * that re-records a worse number has to say in the same commit why.
 */
export function findUnownedDebt(baseline: readonly VitalsRecord[]): TargetBreach[] {
  return findTargetBreaches(baseline).filter((breach) => !breach.debt?.trim());
}

/** Every required route, device and temperature the recorded table is missing. */
export function findUnrecordedRoutes(
  required: readonly string[],
  baseline: readonly VitalsRecord[],
  devices: readonly VitalsDevice[] = ["mobile", "desktop"],
  temperatures: readonly VitalsTemperature[] = ["cold", "warm"],
): string[] {
  const recorded = new Set(
    baseline.map((record) => vitalsRecordKey(record.path, record.device, record.temperature)),
  );
  const missing: string[] = [];
  for (const path of required) {
    for (const device of devices) {
      for (const temperature of temperatures) {
        const key = vitalsRecordKey(path, device, temperature);
        if (!recorded.has(key)) missing.push(key);
      }
    }
  }
  return missing;
}

/**
 * A re-recorded table: the run's own rows, over the rows it did not take.
 *
 * THE RECORDER USED TO WRITE ITS ROWS WHOLESALE, which made a one-device run
 * impossible to take: recording desktop discarded every mobile row in the same
 * write, and recording both devices in one run is the sweep that does not
 * finish. So a record run now REPLACES the cells it measured and LEAVES the
 * rest, keyed by route, device and temperature, which is the same key the
 * regression fence reads a row by.
 *
 * A carried row is not a measured one, and `method.coverage` is the sentence
 * that has to say so: this function merges numbers and never prose.
 *
 * The recorded DEBT reason travels with a row that is still over target, and
 * the recorder prints each one it carried. A re-record used to drop every
 * reason on the floor, so a sweep that changed nothing left the table failing
 * its own unowned-debt fence; carrying it forward keeps the reason attached to
 * the row it was written about, and a row that has newly gone over target still
 * arrives with no reason and still fails until somebody writes one.
 */
export function mergeVitalsRecords(
  existing: readonly VitalsRecord[],
  measured: readonly VitalsRecord[],
): VitalsRecord[] {
  const previous = new Map(
    existing.map((record) => [
      vitalsRecordKey(record.path, record.device, record.temperature),
      record,
    ]),
  );
  const taken = measured.map((record) => {
    const key = vitalsRecordKey(record.path, record.device, record.temperature);
    const before = previous.get(key);
    previous.delete(key);
    const debt = before?.debt?.trim();
    const stillOverTarget = VITAL_METRICS.some(
      (metric) => record[metric] > CORE_WEB_VITAL_TARGETS[metric],
    );
    return debt && stillOverTarget ? { ...record, debt: before?.debt } : record;
  });
  return [...taken, ...previous.values()];
}

/** Every row a merge carried forward a recorded debt reason onto. */
export function carriedDebtKeys(
  existing: readonly VitalsRecord[],
  merged: readonly VitalsRecord[],
): string[] {
  const before = new Map(
    existing.map((record) => [
      vitalsRecordKey(record.path, record.device, record.temperature),
      record,
    ]),
  );
  return merged
    .filter((record) => {
      const key = vitalsRecordKey(record.path, record.device, record.temperature);
      const previous = before.get(key);
      return Boolean(record.debt) && previous?.debt === record.debt && previous !== record;
    })
    .map((record) => vitalsRecordKey(record.path, record.device, record.temperature));
}

/** The same merge for the product timings, keyed by timing and device. */
export function mergeProductTimings(
  existing: readonly ProductTimingRecord[],
  measured: readonly ProductTimingRecord[],
): ProductTimingRecord[] {
  const previous = new Map(
    existing.map((record) => [productTimingKey(record.key, record.device), record]),
  );
  for (const record of measured) previous.delete(productTimingKey(record.key, record.device));
  return [...measured, ...previous.values()];
}

/** Round a vital for printing: milliseconds whole, CLS to three places. */
function formatVital(metric: VitalMetric, value: number): string {
  if (!Number.isFinite(value)) return "unmeasured";
  return metric === "cls" ? value.toFixed(3) : String(Math.round(value));
}

export function formatRegressionTable(regressions: readonly VitalsRegression[]): string {
  if (regressions.length === 0) return "(none)";
  const rows = regressions.map((regression) => {
    const round = (value: number) =>
      regression.metric === "cls" ? value.toFixed(3) : String(Math.round(value));
    return (
      `  ${regression.key.padEnd(34)} ${regression.label.padEnd(10)} ` +
      `baseline ${round(regression.baseline).padStart(8)}  ` +
      `allowed ${round(regression.allowed).padStart(8)}  ` +
      `measured ${round(regression.measured).padStart(8)}`
    );
  });
  return rows.join("\n");
}

/** The recorded table as markdown, so the doc and the sweep print one shape. */
export function formatBaselineTable(records: readonly VitalsRecord[]): string {
  const header =
    "| Route | Device | Cache | LCP (ms) | INP (ms) | CLS |\n" +
    "| --- | --- | --- | ---: | ---: | ---: |";
  const rows = records.map(
    (record) =>
      `| \`${record.path}\` | ${record.device} | ${record.temperature} | ` +
      `${formatVital("lcpMs", record.lcpMs)} | ${formatVital("inpMs", record.inpMs)} | ` +
      `${formatVital("cls", record.cls)} |`,
  );
  return [header, ...rows].join("\n");
}

export function formatProductTimingTable(records: readonly ProductTimingRecord[]): string {
  const header =
    "| Timing | Device | Clock starts on | Median (ms) |\n| --- | --- | --- | ---: |";
  const rows = records.map(
    (record) =>
      `| ${record.label} | ${record.device} | ${record.startedAt} | ${Math.round(record.ms)} |`,
  );
  return [header, ...rows].join("\n");
}
