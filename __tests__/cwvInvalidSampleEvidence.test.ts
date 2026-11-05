// @vitest-environment node
import path from "node:path";

import type { Page, TestInfo } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defined } from "./helpers/defined";

type Sweep = (fixtures: { page: Page }, info: Pick<TestInfo, "outputDir">) => Promise<void>;
const boundary = vi.hoisted(() => ({
  sweep: undefined as Sweep | undefined,
  writeFile: vi.fn<(file: string, contents: string, encoding: string) => Promise<void>>(),
  mkdir: vi.fn(),
  readVitals: vi.fn(),
  exercisePrimaryAction: vi.fn(),
  finishMapPrimaryAction: vi.fn(),
  timeMapUsableVenues: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ mkdir: boundary.mkdir, writeFile: boundary.writeFile }));

// Capture the real sweep callback. Supply browser readings and retain its real artifact logic.
vi.mock("@playwright/test", async () => {
  const { expect: assert } = await import("vitest");
  const ready = () => Promise.resolve();
  return {
    test: Object.assign((name: string, callback: Sweep) => {
      if (name === "records or defends every route's LCP, INP, CLS and the product timings") {
        boundary.sweep = callback;
      }
    }, {
      describe: (_name: string, register: () => void) => register(),
      setTimeout: vi.fn(),
      skip: vi.fn(),
    }),
    expect: (value: unknown, message?: string) => {
      if (typeof value === "function") return { toPass: value };
      if (typeof value === "object" && value !== null && "testLocator" in value) {
        return { toBeVisible: ready, toBeEditable: ready, toBeEnabled: ready };
      }
      return assert(value, message);
    },
  };
});

vi.mock("../e2e/helpers/webVitals", () => ({
  PRIMARY_INTERACTIONS: {},
  PRODUCT_TIMING_CEILING_MS: 180_000,
  VITALS_DEVICES: {
    mobile: { viewport: { width: 390, height: 844 }, cpuThrottleRate: 4, network: { label: "chrome-slow-4g" } },
  },
  SHIPPED_MAP_INIT_SCRIPT: "public/map-first-paint-init.js",
  applyVitalsDevice: vi.fn(),
  clearSampleResidue: vi.fn(),
  coolBrowser: vi.fn(),
  exercisePrimaryAction: boundary.exercisePrimaryAction,
  finishMapPrimaryAction: boundary.finishMapPrimaryAction,
  installVitalsProbe: vi.fn(),
  readVitals: boundary.readVitals,
  serveMapInitScript: vi.fn(),
  timeMapUsableVenues: boundary.timeMapUsableVenues,
  timePlanEditable: vi.fn().mockResolvedValue(100),
  timeVenueSheet: vi.fn().mockResolvedValue(100),
}));

const outputDir = path.join("artifacts", "cwv-evidence-unit");
const diagnostic = path.join(outputDir, "cwv-invalid-samples.json");
const regular = path.join(outputDir, "cwv-run.json");
const baselinePath = path.join(process.cwd(), "perf", "cwv-baseline.json");
const reading = { lcpMs: 1000, inpMs: 40, cls: 0 };
const invalid = [
  [Number.NaN, "NaN"],
  [Number.POSITIVE_INFINITY, "Infinity"],
  [Number.NEGATIVE_INFINITY, "-Infinity"],
] as const;

async function runSweep() {
  await import("../e2e/cwv-baseline.spec");
  const noop = () => Promise.resolve();
  const locator = { testLocator: true, click: noop, fill: noop, count: () => Promise.resolve(0) };
  const page = {
    goto: noop,
    waitForTimeout: noop,
    waitForURL: noop,
    locator: () => ({ ...locator, first: () => locator }),
    getByLabel: () => locator,
    getByRole: () => locator,
  } as unknown as Page;
  await defined(boundary.sweep, "registered CWV sweep")({ page }, { outputDir });
}

function writtenFiles() {
  return boundary.writeFile.mock.calls.map(([file]) => file);
}

function readOutput(file: string): unknown {
  const [, json] = defined(boundary.writeFile.mock.calls.find(([name]) => name === file), file);
  return JSON.parse(json) as unknown;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PUBMAX_CWV_RECORD", "1");
  vi.stubEnv("PUBMAX_CWV_SWEEP", "");
  vi.stubEnv("PUBMAX_CWV_RUNS", "5");
  vi.stubEnv("PUBMAX_CWV_DEVICES", "mobile");
  vi.stubEnv("PUBMAX_CWV_LEGACY_MAP_INIT", "");
  vi.spyOn(Date, "now").mockReturnValue(1000);
  boundary.sweep = undefined;
  boundary.writeFile.mockReset().mockResolvedValue(undefined);
  boundary.mkdir.mockReset().mockResolvedValue(undefined);
  boundary.readVitals.mockReset().mockResolvedValue(reading);
  boundary.exercisePrimaryAction.mockReset().mockResolvedValue(true);
  boundary.finishMapPrimaryAction.mockReset().mockResolvedValue(undefined);
  boundary.timeMapUsableVenues.mockReset().mockResolvedValue(100);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("CWV failure artifacts", () => {
  it.each(invalid)("keeps route %s when the next reading fails", async (value, tag) => {
    boundary.readVitals
      .mockResolvedValueOnce({ ...reading, lcpMs: value })
      .mockRejectedValueOnce(new Error("Route reading failed"));

    await expect(runSweep()).rejects.toThrow("Route reading failed");
    expect(writtenFiles()).toEqual([diagnostic]);
    expect(readOutput(diagnostic)).toEqual({
      status: "invalid",
      error: "Route reading failed",
      cell: {
        kind: "route", key: "mobile:cold:/", path: "/", device: "mobile", temperature: "cold",
        samples: [{ lcpMs: { nonFinite: tag }, inpMs: 40, cls: 0, interacted: true }],
      },
    });
  });

  it.each(invalid)("keeps product %s when the next reading fails", async (value, tag) => {
    boundary.timeMapUsableVenues
      .mockResolvedValueOnce(value)
      .mockRejectedValueOnce(new Error("Product reading failed"));

    await expect(runSweep()).rejects.toThrow("Product reading failed");
    expect(writtenFiles()).toEqual([diagnostic]);
    expect(readOutput(diagnostic)).toEqual({
      status: "invalid",
      error: "Product reading failed",
      cell: {
        kind: "product", key: "mobile:map-usable-venues", device: "mobile",
        startedAt: "navigation start", samples: [{ nonFinite: tag }],
      },
    });
  });

  it("distinguishes null, undefined, and an absent metric in a rejected route cell", async () => {
    boundary.readVitals
      .mockResolvedValueOnce({ ...reading, lcpMs: null })
      .mockResolvedValueOnce({ ...reading, lcpMs: undefined })
      .mockResolvedValueOnce({ inpMs: 40, cls: 0 });

    await expect(runSweep()).rejects.toThrow("Route sample 1 has invalid lcpMs");
    expect(writtenFiles()).toEqual([diagnostic]);
    expect(readOutput(diagnostic)).toMatchObject({
      cell: {
        samples: [
          { lcpMs: null, inpMs: 40, cls: 0, interacted: true },
          { lcpMs: { missing: "undefined" }, inpMs: 40, cls: 0, interacted: true },
          { inpMs: 40, cls: 0, interacted: true },
          { ...reading, interacted: true },
          { ...reading, interacted: true },
        ],
      },
    });
    const output = readOutput(diagnostic) as { cell: { samples: unknown[] } };
    expect(output.cell.samples[2]).not.toHaveProperty("lcpMs");
  });

  it("writes only diagnostic evidence when a product median could hide a bad reading", async () => {
    boundary.timeMapUsableVenues.mockResolvedValueOnce(Number.POSITIVE_INFINITY);

    await expect(runSweep()).rejects.toThrow("Product sample 1 is invalid");
    expect(writtenFiles()).toEqual([diagnostic]);
    expect(readOutput(diagnostic)).toMatchObject({
      cell: { samples: [{ nonFinite: "Infinity" }, 100, 100, 100, 100] },
    });
  });

  it("keeps the rejected Map reading separate when the post-read check fails", async () => {
    vi.stubEnv("PUBMAX_CWV_RUNS", "2");
    const postReadError = new Error("Reset view failed after the vitals read");
    const mapReadings = [reading, { lcpMs: Number.NaN, inpMs: 91, cls: 0.02 }];
    boundary.exercisePrimaryAction.mockImplementation(async (_page: Page, routePath: string) => {
      if (routePath === "/map") boundary.readVitals.mockResolvedValueOnce(mapReadings.shift());
      return true;
    });
    boundary.finishMapPrimaryAction.mockResolvedValueOnce(undefined).mockRejectedValueOnce(postReadError);

    await expect(runSweep()).rejects.toBe(postReadError);
    expect(writtenFiles()).toEqual([diagnostic]);
    expect(readOutput(diagnostic)).toEqual({
      status: "invalid",
      error: "Reset view failed after the vitals read",
      cell: {
        kind: "route", key: "mobile:cold:/map", path: "/map", device: "mobile", temperature: "cold",
        interactionMethod: "map-camera-attitude-reset-v1",
        samples: [{ ...reading, interacted: true }],
        rejectedSample: {
          stage: "post-read",
          sample: { lcpMs: { nonFinite: "NaN" }, inpMs: 91, cls: 0.02, interacted: true },
        },
      },
    });
  });

  it("fails the Map ceiling under the expanded method and identifies the method in the run", async () => {
    vi.stubEnv("PUBMAX_CWV_RECORD", "");
    vi.stubEnv("PUBMAX_CWV_SWEEP", "1");
    vi.stubEnv("PUBMAX_CWV_RUNS", "1");
    boundary.exercisePrimaryAction.mockImplementation(async (_page: Page, routePath: string) => {
      if (routePath === "/map") boundary.readVitals.mockResolvedValueOnce({ ...reading, lcpMs: 20_000 });
      return true;
    });

    const failure = runSweep();
    await expect(failure).rejects.toThrow("Map ceiling breaches under map-camera-attitude-reset-v1");
    await expect(failure).rejects.not.toThrow("Slower than the recorded baseline");
    expect(writtenFiles()).toEqual([regular]);
    expect(readOutput(regular)).toMatchObject({
      method: { routeInteractions: { "/map": "map-camera-attitude-reset-v1" } },
    });
  });

  it.each(["mkdir", "writeFile"] as const)("reports both failures and raw samples when %s rejects", async (operation) => {
    const collectionError = new Error("Route reading failed");
    const persistenceError = new Error(`Diagnostic ${operation} failed`);
    boundary.readVitals
      .mockResolvedValueOnce({ ...reading, lcpMs: Number.NaN, inpMs: undefined })
      .mockRejectedValueOnce(collectionError);
    boundary[operation].mockRejectedValueOnce(persistenceError);

    const failure: unknown = await runSweep().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    const { errors, message } = failure as AggregateError;
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBe(collectionError);
    expect(errors[1]).toBe(persistenceError);
    expect(message).toContain(diagnostic);
    expect(message).toContain(persistenceError.message);
    expect(message).toContain(JSON.stringify({
      status: "invalid",
      error: "Route reading failed",
      cell: {
        kind: "route", key: "mobile:cold:/", path: "/", device: "mobile", temperature: "cold",
        samples: [{ lcpMs: { nonFinite: "NaN" }, inpMs: { missing: "undefined" }, cls: 0, interacted: true }],
      },
    }, null, 2));
    expect(writtenFiles()).toEqual(operation === "mkdir" ? [] : [diagnostic]);
  });

  it("writes a valid one-sample mobile record and preserves the desktop baseline", async () => {
    vi.stubEnv("PUBMAX_CWV_RUNS", "1");
    const { CWV_BASELINE } = await import("../lib/webVitalsBaseline");
    const desktop = CWV_BASELINE.routes.filter((row) => row.device === "desktop");

    await runSweep();
    expect(writtenFiles()).toEqual([regular, baselinePath]);
    const normal = readOutput(regular) as {
      routes: { device: string; cls: number }[];
      productTimings: { ms: number }[];
    };
    expect(normal.routes).toHaveLength(12);
    expect(normal.routes.every((row) => row.device === "mobile" && row.cls === 0)).toBe(true);
    expect(normal.productTimings.map(({ ms }) => ms)).toEqual([100, 100, 100, 0]);
    const recorded = readOutput(baselinePath) as { routes: { device: string }[] };
    expect(recorded.routes.filter((row) => row.device === "desktop")).toEqual(desktop);
  });
});
