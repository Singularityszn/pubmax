import { describe, expect, it } from "vitest";

import {
  CORE_WEB_VITAL_TARGETS,
  CWV_BASELINE,
  MEASURABLE_BASELINE_ROUTES,
  REQUIRED_BASELINE_DEVICES,
  REQUIRED_BASELINE_ROUTES,
  REQUIRED_DESKTOP_BASELINE_ROUTES,
  REQUIRED_LCP_ROUTES,
  REQUIRED_PRODUCT_TIMINGS,
  VITAL_METRICS,
  carriedDebtKeys,
  findProductTimingRegressions,
  findTargetBreaches,
  findUnownedDebt,
  findUnrecordedRoutes,
  findVitalsRegressions,
  formatBaselineTable,
  formatRegressionTable,
  mergeProductTimings,
  mergeVitalsRecords,
  productTimingKey,
  regressionCeiling,
  vitalsRecordKey,
  type ProductTimingRecord,
  type VitalsRecord,
} from "@/lib/webVitalsBaseline";
import { defined } from "@/__tests__/helpers/defined";

// The always-on half of the speed rating.
//
// The browser sweep (e2e/cwv-baseline.spec.ts) is an hour of wall clock and
// belongs to its own job. These are the rules that decide what its numbers
// MEAN, plus the standing checks on the recorded table itself: every route the
// audit named is recorded, and every figure over its R2 target owns its reason.
// Both run in the ordinary `npm test`, so a table that quietly loses a route or
// quietly records a slower number fails on the commit that does it.

const record = (over: Partial<VitalsRecord> = {}): VitalsRecord => ({
  path: "/",
  device: "mobile",
  temperature: "cold",
  lcpMs: 1000,
  inpMs: 40,
  cls: 0.01,
  ...over,
});

describe("the regression rule", () => {
  it("takes the larger of the percentage and the floor, so a small figure is not fenced to the pixel", () => {
    // 40 ms + 50% is 60; the 80 ms floor is larger, so the floor wins.
    expect(regressionCeiling("inpMs", 40)).toBe(120);
    // 4000 ms + 30% is 5200; the 250 ms floor is smaller, so the percentage wins.
    expect(regressionCeiling("lcpMs", 4000)).toBe(5200);
  });

  it("treats an unknown metric as a product timing rather than as unfenced", () => {
    expect(regressionCeiling("some-new-timing", 1000)).toBe(regressionCeiling("productMs", 1000));
  });

  it("fails a figure past the allowance and passes one inside it", () => {
    const baseline = [record({ lcpMs: 1000 })];
    const key = vitalsRecordKey("/", "mobile", "cold");

    const inside = findVitalsRegressions(
      baseline,
      new Map([[key, { lcpMs: 1290, inpMs: 40, cls: 0.01 }]]),
    );
    expect(inside).toEqual([]);

    const past = findVitalsRegressions(
      baseline,
      new Map([[key, { lcpMs: 1400, inpMs: 40, cls: 0.01 }]]),
    );
    expect(past).toHaveLength(1);
    expect(past[0]).toMatchObject({ metric: "lcpMs", baseline: 1000, measured: 1400 });
  });

  it("names every metric that lost ground, not just the first", () => {
    const key = vitalsRecordKey("/", "mobile", "cold");
    const regressions = findVitalsRegressions(
      [record()],
      new Map([[key, { lcpMs: 9000, inpMs: 900, cls: 0.9 }]]),
    );
    expect(regressions.map((entry) => entry.metric).sort()).toEqual([...VITAL_METRICS].sort());
  });

  it("skips a recorded row the sweep never measured, so a one-device run still fences", () => {
    // A sweep may legitimately run a subset. Calling the routes it never opened
    // regressions would make the fence useless at that size.
    expect(findVitalsRegressions([record({ device: "desktop" })], new Map())).toEqual([]);
  });

  it("never reads an unmeasured figure as a regression", () => {
    const key = vitalsRecordKey("/", "mobile", "cold");
    expect(
      findVitalsRegressions(
        [record()],
        new Map([[key, { lcpMs: Number.NaN, inpMs: Number.NaN, cls: Number.NaN }]]),
      ),
    ).toEqual([]);
  });

  it("fences a product timing on the same rule", () => {
    const timing: ProductTimingRecord = {
      key: "map-usable-venues",
      label: "usable venue results on /map",
      device: "mobile",
      startedAt: "navigation start",
      ms: 4000,
    };
    const key = productTimingKey("map-usable-venues", "mobile");
    expect(findProductTimingRegressions([timing], new Map([[key, 5100]]))).toEqual([]);
    expect(findProductTimingRegressions([timing], new Map([[key, 5300]]))).toHaveLength(1);
  });
});

describe("the R2 targets", () => {
  it("are Google's own good thresholds", () => {
    expect(CORE_WEB_VITAL_TARGETS).toEqual({ lcpMs: 2500, inpMs: 200, cls: 0.1 });
  });

  it("reports a figure over target with the reason it is carried", () => {
    const breaches = findTargetBreaches([record({ lcpMs: 4000, debt: "the map streams shards" })]);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ metric: "lcpMs", debt: "the map streams shards" });
  });

  it("calls a figure over target with no reason unowned debt", () => {
    expect(findUnownedDebt([record({ lcpMs: 4000 })])).toHaveLength(1);
    expect(findUnownedDebt([record({ lcpMs: 4000, debt: "  " })])).toHaveLength(1);
    expect(findUnownedDebt([record({ lcpMs: 4000, debt: "measured, owned" })])).toEqual([]);
  });
});

describe("the recorded table", () => {
  it("records every route the audit named on the required device, cold and warm", () => {
    const missing = findUnrecordedRoutes(
      REQUIRED_BASELINE_ROUTES,
      CWV_BASELINE.routes,
      REQUIRED_BASELINE_DEVICES,
    );
    expect(missing, `Unrecorded, so nothing can regress them: ${missing.join(", ")}`).toEqual([]);
  });

  it("says in words what it holds and what it does not", () => {
    // A partial table that does not say it is partial reads as a complete one,
    // and the reader then takes an unmeasured device for a fast one.
    expect(CWV_BASELINE.method.coverage.trim().length).toBeGreaterThan(0);
    const devices = new Set(CWV_BASELINE.routes.map((row) => row.device));
    for (const device of REQUIRED_BASELINE_DEVICES) {
      expect(devices.has(device), `${device} is required but unrecorded`).toBe(true);
    }
  });

  it("carries a reason for every figure outside its R2 target", () => {
    const unowned = findUnownedDebt(CWV_BASELINE.routes);
    expect(
      unowned,
      `Over target with no reason: ${unowned
        .map((breach) => `${breach.key} ${breach.metric}=${breach.measured}`)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("never loses the /map first-pin timing or its cold LCP, whatever else a run reached", () => {
    // These two are the fence the map fix is judged by, so they are required by
    // NAME rather than by counting whatever rows a run produced.
    const timings = new Set(
      CWV_BASELINE.productTimings.map((timing) => productTimingKey(timing.key, timing.device)),
    );
    for (const key of REQUIRED_PRODUCT_TIMINGS) {
      for (const device of REQUIRED_BASELINE_DEVICES) {
        const required = productTimingKey(key, device);
        expect(timings.has(required), `${required} is required and unrecorded`).toBe(true);
      }
    }

    const rows = new Set(
      CWV_BASELINE.routes.map((row) => vitalsRecordKey(row.path, row.device, row.temperature)),
    );
    for (const path of REQUIRED_LCP_ROUTES) {
      for (const device of REQUIRED_BASELINE_DEVICES) {
        for (const temperature of ["cold", "warm"] as const) {
          const required = vitalsRecordKey(path, device, temperature);
          expect(rows.has(required), `${required} is required and unrecorded`).toBe(true);
        }
      }
    }
  });

  it("records only product timings a run actually printed", () => {
    // A timing a run never reached is ABSENT rather than zero: the sweep that
    // wrote this table timed out on plan-acknowledged-save, and a zero there
    // would have read as an instant save.
    for (const timing of CWV_BASELINE.productTimings) {
      expect(timing.ms, `${timing.key} ${timing.device}`).toBeGreaterThan(0);
    }
  });

  it("states the rig it was taken on, because a baseline without one is a number", () => {
    expect(CWV_BASELINE.method.runs).toBeGreaterThanOrEqual(3);
    expect(CWV_BASELINE.method.aggregate).toBe("median");
    expect(CWV_BASELINE.method.recordedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CWV_BASELINE.method.devices.mobile.viewport).toEqual({ width: 390, height: 844 });
    expect(CWV_BASELINE.method.devices.mobile.cpuThrottleRate).toBe(4);
    expect(CWV_BASELINE.method.devices.mobile.network).toBe("chrome-slow-4g");
  });

  it("holds no figure the sweep failed to read", () => {
    for (const row of CWV_BASELINE.routes) {
      for (const metric of VITAL_METRICS) {
        expect(Number.isFinite(row[metric]), `${row.path} ${row.device} ${metric}`).toBe(true);
      }
    }
    for (const timing of CWV_BASELINE.productTimings) {
      expect(Number.isFinite(timing.ms), `${timing.key} ${timing.device}`).toBe(true);
    }
  });
});

describe("the merge a record run writes with", () => {
  // The recorder used to write its rows wholesale, which made a one-device run
  // impossible to take: recording desktop discarded every mobile row in the
  // same write, and recording both devices in one run is the sweep that does
  // not finish. These are the rules that let a device be re-taken alone.
  it("replaces the cells a run measured and leaves every other one as recorded", () => {
    const merged = mergeVitalsRecords(
      [record({ lcpMs: 1000 }), record({ device: "desktop", lcpMs: 2000 })],
      [record({ device: "desktop", lcpMs: 2400 })],
    );
    const byKey = new Map(
      merged.map((row) => [vitalsRecordKey(row.path, row.device, row.temperature), row]),
    );
    expect(byKey.get(vitalsRecordKey("/", "desktop", "cold"))?.lcpMs).toBe(2400);
    expect(byKey.get(vitalsRecordKey("/", "mobile", "cold"))?.lcpMs).toBe(1000);
    expect(merged).toHaveLength(2);
  });

  it("keeps a still-breached row's own recorded reason rather than dropping it on the floor", () => {
    const before = [record({ lcpMs: 4000, debt: "the map streams shards" })];
    const merged = mergeVitalsRecords(before, [record({ lcpMs: 4100 })]);
    expect(defined(merged[0]).debt).toBe("the map streams shards");
    expect(carriedDebtKeys(before, merged)).toEqual([vitalsRecordKey("/", "mobile", "cold")]);
    expect(findUnownedDebt(merged)).toEqual([]);
  });

  it("lets a reason go when the figure it was written about came back inside target", () => {
    const merged = mergeVitalsRecords(
      [record({ lcpMs: 4000, debt: "the map streams shards" })],
      [record({ lcpMs: 1800 })],
    );
    expect(defined(merged[0]).debt).toBeUndefined();
  });

  it("gives a newly breached row no reason, so the unowned-debt fence still fires", () => {
    const merged = mergeVitalsRecords([record({ lcpMs: 1000 })], [record({ lcpMs: 4000 })]);
    expect(findUnownedDebt(merged)).toHaveLength(1);
  });

  it("merges product timings on the timing and the device", () => {
    const timing = (over: Partial<ProductTimingRecord> = {}): ProductTimingRecord => ({
      key: "map-usable-venues",
      label: "usable venue results on /map",
      device: "mobile",
      startedAt: "navigation start",
      ms: 4000,
      ...over,
    });
    const merged = mergeProductTimings(
      [timing(), timing({ device: "desktop", ms: 900 })],
      [timing({ device: "desktop", ms: 1200 })],
    );
    const byKey = new Map(merged.map((row) => [productTimingKey(row.key, row.device), row]));
    expect(byKey.get(productTimingKey("map-usable-venues", "desktop"))?.ms).toBe(1200);
    expect(byKey.get(productTimingKey("map-usable-venues", "mobile"))?.ms).toBe(4000);
  });
});

describe("the desktop half of the table", () => {
  // Astra's 6 September audit read a desktop field p75 LCP of 3,686 ms against
  // a table holding zero desktop rows, so nothing in the tree could regress.
  // These rows are the answer, and this is the gate that keeps them.
  it("records the three routes the desktop finding names, cold and warm", () => {
    const missing = findUnrecordedRoutes(
      REQUIRED_DESKTOP_BASELINE_ROUTES,
      CWV_BASELINE.routes,
      ["desktop"],
    );
    expect(missing, `Unrecorded, so nothing can regress them: ${missing.join(", ")}`).toEqual([]);
  });

  it("states the desktop rig, because a figure without one is a number", () => {
    const rig = CWV_BASELINE.method.devices.desktop;
    expect(rig, "desktop rows are recorded, so the rig they were taken on must be too").toBeDefined();
    expect(rig?.viewport).toEqual({ width: 1440, height: 900 });
  });

  it("names a primary action for every route any device measures", () => {
    // The sweep asserts the same thing against its own interaction table; this
    // is the half that runs without a browser, so a route added to a device
    // list and left uninteracted fails on the commit that adds it.
    expect(MEASURABLE_BASELINE_ROUTES).toContain("/pal");
    for (const path of REQUIRED_DESKTOP_BASELINE_ROUTES) {
      expect(MEASURABLE_BASELINE_ROUTES).toContain(path);
    }
  });
});

describe("the printed tables", () => {
  it("prints CLS to three places and milliseconds whole", () => {
    const table = formatBaselineTable([record({ lcpMs: 1234.6, inpMs: 41.4, cls: 0.0123 })]);
    expect(table).toContain("| 1235 | 41 | 0.012 |");
  });

  it("says so plainly when nothing regressed", () => {
    expect(formatRegressionTable([])).toBe("(none)");
  });
});
