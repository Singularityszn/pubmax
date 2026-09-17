import { describe, expect, it } from "vitest";

import {
  BUDGET_METRICS,
  PERFORMANCE_BUDGETS,
  findMethodWarnings,
  formatSampleTable,
  perfSampleSpread,
  resolveCountBoundary,
  type SampleRow,
} from "../lib/performanceBudgets";

/**
 * The gate that fails on unchanged code (#1314), pinned.
 *
 * A docs-only commit on main measured `/today` at 54 requests where the same
 * tree had measured 43, because the moment the count stopped was timed by the
 * HARNESS: Playwright polls for a visible selector, then asks the page for its
 * clock, and both take longer on a loaded runner. The app's post-paint idle
 * warmup (`lib/mapWarmup.ts`, a 2000 ms idle timeout) then lands inside the
 * count or outside it depending on that delay.
 *
 * The boundary is now the PAGE's own: the later of its load event and the first
 * in-page frame its readiness gate held. These cases are written so that the
 * old behaviour - taking the harness figure - fails every one of them.
 */
describe("resolveCountBoundary", () => {
  it("ignores a late harness observation when the page timed its own readiness", () => {
    // The shape of the flake: the page was ready at 900 ms, the harness only
    // said so at 2400 ms, and an idle prefetch burst started at 1400 ms.
    const { boundaryMs, source } = resolveCountBoundary({
      loadEventEndMs: 820,
      pageReadyAtMs: 900,
      harnessReadyAtMs: 2_400,
    });

    expect(boundaryMs).toBe(900);
    expect(source).toBe("page-ready");
    // The old behaviour counted to 2400 and swallowed the burst.
    expect(boundaryMs).toBeLessThan(1_400);
  });

  it("gives the same boundary however long the harness took", () => {
    const fast = resolveCountBoundary({
      loadEventEndMs: 820,
      pageReadyAtMs: 900,
      harnessReadyAtMs: 950,
    });
    const slow = resolveCountBoundary({
      loadEventEndMs: 820,
      pageReadyAtMs: 900,
      harnessReadyAtMs: 6_000,
    });

    expect(slow).toEqual(fast);
  });

  it("never cuts before the document's own load event", () => {
    // A readiness selector can be server-rendered and visible before the load
    // event; the counted set must still include everything the document itself
    // asked for.
    const { boundaryMs } = resolveCountBoundary({
      loadEventEndMs: 1_100,
      pageReadyAtMs: 300,
      harnessReadyAtMs: 1_500,
    });

    expect(boundaryMs).toBe(1_100);
  });

  it("falls back to the harness clock, and says so, when the gate never held", () => {
    const { boundaryMs, source } = resolveCountBoundary({
      loadEventEndMs: 820,
      pageReadyAtMs: Number.NaN,
      harnessReadyAtMs: 2_400,
    });

    expect(boundaryMs).toBe(2_400);
    expect(source).toBe("harness-ready");
  });

  it("treats a missing navigation entry as no floor rather than as time zero", () => {
    const { boundaryMs } = resolveCountBoundary({
      loadEventEndMs: Number.NaN,
      pageReadyAtMs: 640,
      harnessReadyAtMs: 900,
    });

    expect(boundaryMs).toBe(640);
  });
});

describe("perfSampleSpread", () => {
  it("reports how far apart one route's own samples sat", () => {
    // The #1314 figures, as if they had landed inside one run.
    expect(perfSampleSpread([43, 52, 54])).toEqual({ min: 43, max: 54, spreadPct: 21 });
  });

  it("keeps an unmeasurable sample unmeasurable rather than narrow", () => {
    expect(Number.isNaN(perfSampleSpread([43, Number.NaN, 54]).spreadPct)).toBe(true);
  });

  it("calls identical samples a zero spread", () => {
    expect(perfSampleSpread([48, 48, 48]).spreadPct).toBe(0);
  });
});

function sample(requests: number, boundarySource?: SampleRow["boundarySource"]): SampleRow {
  return {
    serverRenderMs: 5,
    jsDecodedKB: 900,
    requests,
    lcpMs: 100,
    ...(boundarySource ? { boundarySource } : {}),
  };
}

describe("findMethodWarnings", () => {
  it("names a route whose own samples sat further apart than the tracked width", () => {
    const warnings = findMethodWarnings(
      new Map([["/today", [sample(43), sample(52), sample(54)]]]),
      PERFORMANCE_BUDGETS.method.sampleSpreadWarnPct,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("/today requests");
    expect(warnings[0]).toContain("43 to 54");
  });

  it("stays quiet when every sample agrees", () => {
    expect(
      findMethodWarnings(new Map([["/today", [sample(43), sample(43), sample(43)]]])),
    ).toEqual([]);
  });

  it("stays quiet on a wide percentage that is a narrow gap", () => {
    // The measured shape: server render sits at single-digit milliseconds, so
    // one millisecond of scheduler jitter is a 33% spread on every route on
    // every run. A warning that fires on everything is a warning nobody reads.
    const jitter: SampleRow[] = [
      { serverRenderMs: 3, jsDecodedKB: 887, requests: 41, lcpMs: 132 },
      { serverRenderMs: 4, jsDecodedKB: 887, requests: 41, lcpMs: 132 },
      { serverRenderMs: 4, jsDecodedKB: 887, requests: 41, lcpMs: 132 },
    ];

    expect(findMethodWarnings(new Map([["/", jitter]]))).toEqual([]);
  });

  it("still names a gap wide enough to move a gate", () => {
    const real: SampleRow[] = [
      { serverRenderMs: 40, jsDecodedKB: 887, requests: 41, lcpMs: 132 },
      { serverRenderMs: 90, jsDecodedKB: 887, requests: 41, lcpMs: 132 },
      { serverRenderMs: 95, jsDecodedKB: 887, requests: 41, lcpMs: 132 },
    ];

    const warnings = findMethodWarnings(new Map([["/", real]]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("40 to 95");
  });

  it("names a sample that had to fall back to the harness clock", () => {
    const warnings = findMethodWarnings(
      new Map([["/map", [sample(133, "page-ready"), sample(133, "harness-ready")]]]),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("1 of 2 sample(s) fell back to the harness clock");
  });
});

describe("formatSampleTable", () => {
  it("prints every sample beside its median, which is the evidence #1314 asked for", () => {
    const table = formatSampleTable(new Map([["/today", [sample(43), sample(52), sample(54)]]]));

    expect(table).toContain("43 / 52 / 54");
    expect(table).toContain("spread");
  });

  it("prints nothing when nothing was sampled", () => {
    expect(formatSampleTable(new Map())).toBe("");
  });
});

describe("the tracked method", () => {
  it("states its own sample count, its warm-up and whose clock cuts the count", () => {
    // A figure is only comparable to the one before it when the method that
    // produced both is written down rather than remembered.
    const method = PERFORMANCE_BUDGETS.method;
    expect(method.warmupRuns).toBeGreaterThanOrEqual(1);
    expect(method.measuredRuns).toBeGreaterThanOrEqual(3);
    expect(method.aggregate).toBe("median");
    expect(method.cpuThrottleRate).toBe(4);
    expect(method.viewport).toEqual({ width: 390, height: 844 });
    expect(method.boundaryClock).toBe("page");
    expect(method.sampleSpreadWarnPct).toBeGreaterThan(0);
    // A percentage alone is not information at these magnitudes, so every
    // metric names the gap it has to open before the run says anything.
    expect(Object.keys(method.sampleSpreadFloors).sort()).toEqual(
      [...BUDGET_METRICS].sort(),
    );
  });
});
