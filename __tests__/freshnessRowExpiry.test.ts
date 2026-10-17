// A DATASET WHOSE ROWS CARRY THEIR OWN EXPIRY IS STALE WHEN EVERY ROW HAS EXPIRED.
//
// late_food_evidence was dated only by its file's `generatedAt`, a 2,160h
// neglect budget, while every one of its rows carries a 30-day `expiresAt` that
// lib/lateFood.ts enforces at request time. All twenty expired on 2026-08-16, so
// from 17 August /api/late-food and both plan-ending builders answered with no
// late food at all, and the freshness gate read the file at 1,939h of 2,160h and
// called it a snapshot. The file was inside its budget; nothing in it could be
// served.
//
// A dataset that declares `rowExpiry` (a path to each row's own expiry, `*`
// walking an array or an object's values) is judged by its rows too: once the
// LATEST row expiry has passed, no row is servable and the dataset is stale,
// whatever its file stamp says. A declared path that finds no dated row is
// unknown, because the audit cannot see what it was told to look at. Both
// readers reach the same verdict.
//
// A PARTLY lapsed row set is named, never hidden. After the 2026-10-17
// re-review 12 of 20 rows kept their August expiry, lib/lateFood.ts refused
// them, and the gate still read the dataset fresh. The captain ruled the same
// day that a partial lapse moves no status: the detail line names the count
// ("12 of 20 rows past their own expiry") in both readers, and the CLI prints
// it under its own heading. It fails nothing.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import registry from "@/data/freshness_registry.json";
import lateFoodEvidence from "@/public/data/late_food_evidence.json";
import { evaluateFreshness } from "@/scripts/check_freshness.mjs";
import {
  datasetOpensArtifact,
  evaluateDataset,
  evaluateRegistry,
  readRowExpiry,
  type FreshnessDataset,
  type FreshnessRegistry,
} from "@/lib/freshness";
import { resolveDatasetStamp, resolveDatasetStampWithOverlay } from "@/lib/freshnessArtifact";
import { freshnessArtifactIncludes } from "@/lib/freshnessTracing.mjs";
import { notifyFreshnessFindings } from "@/lib/freshnessNotify";
import { defined } from "@/__tests__/helpers/defined";

const ARTIFACT = "public/data/row_expiry_lane.json";
const PATH = "areas.*.options.*.source.expiresAt";

function lane(overrides: Partial<FreshnessDataset> = {}): FreshnessDataset {
  return {
    id: "row_expiry_lane",
    label: "Row expiry lane",
    class: "episodic",
    artifact: ARTIFACT,
    stamp: { kind: "field", pointer: "generatedAt" },
    cadence: "episodic",
    stalenessBudgetHours: 2160,
    refreshWorkflow: "manual",
    gate: "none",
    rowExpiry: PATH,
    ...overrides,
  };
}

function artifact(expiries: string[]) {
  return {
    generatedAt: "2026-07-27T12:00:00.000Z",
    areas: {
      north: { options: expiries.slice(0, 1).map((expiresAt) => ({ source: { expiresAt } })) },
      south: { options: expiries.slice(1).map((expiresAt) => ({ source: { expiresAt } })) },
    },
  };
}

describe("readRowExpiry", () => {
  const now = new Date("2026-08-20T00:00:00Z");

  it("walks arrays and object values and keeps the latest parseable expiry", () => {
    expect(readRowExpiry(PATH, artifact(["2026-08-16T00:00:00Z", "2026-09-01T00:00:00Z"]), now)).toEqual({
      rows: 2,
      expired: 1,
      latestExpiresAt: "2026-09-01T00:00:00Z",
    });
  });

  it("counts a row expiring at the very instant as expired, as lib/lateFood.ts refuses it", () => {
    expect(readRowExpiry(PATH, artifact(["2026-08-20T00:00:00Z"]), now).expired).toBe(1);
  });

  it("counts no row when the path finds nothing dated", () => {
    expect(readRowExpiry(PATH, { generatedAt: "x", areas: {} }, now)).toEqual({
      rows: 0,
      expired: 0,
      latestExpiresAt: null,
    });
    expect(readRowExpiry(PATH, artifact(["not a date"]), now)).toEqual({ rows: 0, expired: 0, latestExpiresAt: null });
  });
});

describe("evaluateDataset with rowExpiry", () => {
  const observedAt = "2026-07-27T12:00:00.000Z";

  it("is stale once every row has expired, even inside the file budget", () => {
    const result = evaluateDataset(lane(), observedAt, new Date("2026-08-17T20:00:00Z"), null, {
      rows: 20,
      expired: 20,
      latestExpiresAt: "2026-08-16T22:30:00.000Z",
    });
    expect(result.status).toBe("stale");
    expect(result.detail).toContain("20 rows");
    expect(result.detail).toContain("2026-08-16T22:30:00.000Z");
  });

  it("answers from the file budget while any row is still servable", () => {
    const result = evaluateDataset(lane(), observedAt, new Date("2026-08-01T20:00:00Z"), null, {
      rows: 20,
      expired: 0,
      latestExpiresAt: "2026-08-16T22:30:00.000Z",
    });
    expect(result.status).toBe("fresh");
    expect(result.detail).not.toContain("past their own expiry");
  });

  it("names a partial lapse in the detail and keeps the file's own status", () => {
    const reading = { rows: 20, expired: 12, latestExpiresAt: "2026-11-16T14:03:32.000Z" };
    const now = new Date("2026-08-01T20:00:00Z");
    const fresh = evaluateDataset(lane(), observedAt, now, null, reading);
    expect(fresh.status).toBe("fresh");
    expect(fresh.detail).toContain("12 of 20 rows past their own expiry");
    // The note rides every status the file itself can answer.
    const snapshot = evaluateDataset(lane(), observedAt, new Date("2026-09-10T00:00:00Z"), null, reading);
    expect(snapshot.status).toBe("snapshot");
    expect(snapshot.detail).toContain("12 of 20 rows past their own expiry");
    const overBudget = evaluateDataset(lane({ stalenessBudgetHours: 24 }), observedAt, now, null, reading);
    expect(overBudget.status).toBe("stale");
    expect(overBudget.detail).toContain("over the 24h budget");
    expect(overBudget.detail).toContain("12 of 20 rows past their own expiry");
    const closed = evaluateDataset(lane({ class: "snapshot", stalenessBudgetHours: null }), observedAt, now, null, reading);
    expect(closed.status).toBe("snapshot");
    expect(closed.detail).toContain("12 of 20 rows past their own expiry");
  });

  it("is unknown when the declared path finds no dated row", () => {
    const result = evaluateDataset(lane(), observedAt, new Date("2026-08-01T20:00:00Z"), null, {
      rows: 0,
      expired: 0,
      latestExpiresAt: null,
    });
    expect(result.status).toBe("unknown");
    expect(result.detail).toContain(PATH);
  });

  it("is unknown when a declared row expiry was never read", () => {
    const result = evaluateDataset(lane(), observedAt, new Date("2026-08-01T20:00:00Z"), null);
    expect(result.status).toBe("unknown");
  });

  it("leaves a dataset without rowExpiry exactly as it was", () => {
    const result = evaluateDataset(lane({ rowExpiry: undefined }), observedAt, new Date("2026-08-17T20:00:00Z"));
    expect(result.status).toBe("fresh");
  });

  it("is carried through evaluateRegistry from the stamp resolution", () => {
    const reg: FreshnessRegistry = { version: 1, datasets: [lane()] };
    const [result] = evaluateRegistry(
      reg,
      () => ({ observedAt, reason: null, rowExpiry: { rows: 1, expired: 1, latestExpiresAt: "2026-08-16T00:00:00Z" } }),
      new Date("2026-08-17T00:00:00Z"),
    );
    expect(defined(result).status).toBe("stale");
  });
});

describe("both readers open and judge the rows", () => {
  let rootDir = "";

  beforeAll(() => {
    rootDir = mkdtempSync(join(tmpdir(), "row-expiry-"));
    mkdirSync(join(rootDir, "public", "data"), { recursive: true });
    writeFileSync(
      join(rootDir, ARTIFACT),
      JSON.stringify(artifact(["2026-08-16T22:30:00.000Z", "2026-08-10T00:00:00.000Z"])),
    );
  });

  afterAll(() => rmSync(rootDir, { recursive: true, force: true }));

  it("a rowExpiry dataset opens its artifact even with a literal stamp", () => {
    expect(
      datasetOpensArtifact(lane({ stamp: { kind: "literal", value: "2026-07-27T12:00:00Z" } })),
    ).toBe(true);
  });

  it("the app seam returns the row reading at the caller's clock", () => {
    const now = new Date("2026-08-12T00:00:00Z");
    expect(resolveDatasetStamp(rootDir, lane(), undefined, now).rowExpiry).toEqual({
      rows: 2,
      expired: 1,
      latestExpiresAt: "2026-08-16T22:30:00.000Z",
    });
  });

  it("a durable-store overlay replaces the file stamp but keeps the row reading", () => {
    const now = new Date("2026-08-12T00:00:00Z");
    const resolution = resolveDatasetStampWithOverlay(rootDir, lane(), "2026-08-20T00:00:00Z", now);
    expect(resolution.observedAt).toBe("2026-08-20T00:00:00Z");
    expect(resolution.rowExpiry).toEqual({ rows: 2, expired: 1, latestExpiresAt: "2026-08-16T22:30:00.000Z" });
    expect(resolveDatasetStampWithOverlay(rootDir, lane({ rowExpiry: undefined }), "2026-08-20T00:00:00Z")).toEqual({
      observedAt: "2026-08-20T00:00:00Z",
      reason: null,
    });
  });

  it("the CLI mirror reaches the same verdict on either side of the last expiry", async () => {
    const reg: FreshnessRegistry = { version: 1, datasets: [lane()] };
    // The CLI mirror is plain ESM, so its registry parameter is untyped rows.
    const cliRegistry = { version: 1, datasets: [{ ...lane() }] };
    for (const [now, status] of [
      ["2026-08-01T20:00:00Z", "fresh"],
      ["2026-08-17T20:00:00Z", "stale"],
    ] as const) {
      const cli = await evaluateFreshness({ now: new Date(now), rootDir, registry: cliRegistry });
      const app = evaluateRegistry(reg, (d) => resolveDatasetStamp(rootDir, d), new Date(now));
      expect(defined(cli.results[0]).status).toBe(status);
      expect(defined(app[0]).status).toBe(status);
    }
  });

  it("both readers write the same partial-lapse detail", async () => {
    const now = new Date("2026-08-12T00:00:00Z");
    const reg: FreshnessRegistry = { version: 1, datasets: [lane()] };
    const cli = await evaluateFreshness({ now, rootDir, registry: { version: 1, datasets: [{ ...lane() }] } });
    const app = evaluateRegistry(reg, (d) => resolveDatasetStamp(rootDir, d, undefined, now), now);
    expect(defined(app[0]).status).toBe("fresh");
    expect(defined(app[0]).detail).toContain("1 of 2 rows past their own expiry");
    expect(defined(cli.results[0]).status).toBe(defined(app[0]).status);
    expect(defined(cli.results[0]).detail).toBe(defined(app[0]).detail);
  });
});

describe("late_food_evidence", () => {
  const entry = registry.datasets.find((d) => d.id === "late_food_evidence") as
    | (FreshnessDataset & { rowExpiry?: string })
    | undefined;

  it("declares the path to its rows' own expiry", () => {
    expect(defined(entry).rowExpiry).toBe(PATH);
  });

  it("is traced into both freshness functions", () => {
    const includes = Object.values(freshnessArtifactIncludes(registry)).flat();
    expect(includes).toContain("./public/data/late_food_evidence.json");
  });

  it("reads stale against its committed rows once their last expiry has passed", async () => {
    const reg = { version: 1, datasets: [{ ...defined(entry) }] };
    const latest = Math.max(
      ...Object.values(lateFoodEvidence.areas).flatMap((area) =>
        area.options.map((option) => Date.parse(option.source.expiresAt)),
      ),
    );
    const before = await evaluateFreshness({ now: new Date(latest - 60 * 60 * 1000), registry: reg });
    const after = await evaluateFreshness({ now: new Date(latest + 60 * 60 * 1000), registry: reg });
    expect(defined(before.results[0]).status).not.toBe("stale");
    expect(defined(after.results[0]).status).toBe("stale");
  });

  it("names every committed row past its expiry while some row is still servable", async () => {
    const reg = { version: 1, datasets: [{ ...defined(entry) }] };
    const expiries = Object.values(lateFoodEvidence.areas).flatMap((area) =>
      area.options.map((option) => Date.parse(option.source.expiresAt)),
    );
    const now = new Date(Math.max(...expiries) - 60 * 60 * 1000);
    const expired = expiries.filter((t) => t <= now.getTime()).length;
    const { results } = await evaluateFreshness({ now, registry: reg });
    if (expired === 0) {
      expect(defined(results[0]).detail).not.toContain("past their own expiry");
    } else {
      expect(defined(results[0]).detail).toContain(`${expired} of ${expiries.length} rows past their own expiry`);
    }
  });
});

describe("the stale alert names both causes", () => {
  it("does not call an expired-rows finding a budget breach", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = evaluateDataset(lane(), "2026-07-27T12:00:00.000Z", new Date("2026-08-17T20:00:00Z"), null, {
      rows: 20,
      expired: 20,
      latestExpiresAt: "2026-08-16T22:30:00.000Z",
    });
    notifyFreshnessFindings([result], []);
    const lines = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(lines).toContain("every row past its own expiry");
    expect(lines).not.toContain("breaching freshness budget");
    errorSpy.mockRestore();
  });
});
