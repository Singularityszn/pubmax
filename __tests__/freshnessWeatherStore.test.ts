// THE WEATHER FEED IS MEASURED WHERE THE CRON WRITES IT.
//
// The registry dated `weather` by public/data/weather/latest.json while the
// 6-hourly cron writes the durable weather_snapshots store, and a Vercel
// filesystem is read-only: that committed copy can only ever age, so
// `node scripts/check_freshness.mjs` reported the lane stale however healthy
// the cron was, and reported it stale for ever. Two rules ride on that fix and
// this file holds both.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateFreshness } from "@/scripts/check_freshness.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

type Dataset = {
  id: string;
  artifact: string | null;
  artifactRole?: string;
  stamp: { kind: string; feedKey?: string; pointer?: string } | null;
  stalenessBudgetHours: number | null;
};

function registry(): { version: number; datasets: Dataset[] } {
  return JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
}

function checkFreshness(args: string[]) {
  return spawnSync(process.execPath, ["scripts/check_freshness.mjs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    // The tree runs keyless: no store credentials reach this process.
    env: { ...process.env, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
  });
}

describe("the weather freshness measurement", () => {
  it("measures the durable store, and keeps the committed file as a named fallback", () => {
    const weather = registry().datasets.find((dataset) => dataset.id === "weather");

    expect(weather?.stamp).toEqual({ kind: "store", feedKey: "weather" });
    expect(weather?.stalenessBudgetHours).toBe(48);
    // The file is still served when the store is away, so it stays in the
    // registry - declared as a fallback that dates nothing.
    expect(weather?.artifact).toBe("public/data/weather/latest.json");
    expect(weather?.artifactRole).toBe("degraded-fallback");
  });

  it("reads the table the weather cron actually writes", () => {
    const script = readFileSync(join(ROOT, "scripts/check_freshness.mjs"), "utf8");
    expect(script).toContain("weather_snapshots");
    expect(script).toContain("DURABLE_FEED_SOURCES");
  });

  it("names the weather store unmeasurable with no credentials", () => {
    // The credential case asserts only the weather lines, which print on both
    // branches of the check, never the exit code or the summary sentence of
    // the whole run. It once asserted `status === 0` and the absence of
    // FRESHNESS CHECK FAILED, so a food-menu snapshot ageing past its budget
    // took this weather proof red with it (astra-review P0-1). The exit code
    // has its own case below, where the store is REQUIRED.
    const result = checkFreshness([]);

    expect(result.stdout).toContain("UNRESOLVED (the age could not be determined):");
    expect(result.stdout).toContain(
      '? weather: Durable store for "weather" is unmeasurable without credentials in this runtime.',
    );
  });

  it("never reports the weather row fresh without credentials, whatever the rest of the registry does", async () => {
    // vitest.setup.ts deletes SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before
    // any test runs, so the keyless baseline is the setup file's contract and
    // this case calls the checker directly.
    const { version, datasets } = registry();
    const weather = datasets.find((dataset) => dataset.id === "weather");
    expect(weather).toBeDefined();
    const { results } = await evaluateFreshness({
      rootDir: ROOT,
      registry: { version, datasets: [weather as Dataset] },
    });

    expect(results).toHaveLength(1);
    expect(defined(results[0]).id).toBe("weather");
    expect(defined(results[0]).status).toBe("unknown");
    expect(defined(results[0]).status).not.toBe("fresh");
    expect(defined(results[0]).status).not.toBe("stale");
    expect(defined(results[0]).detail).toContain('Durable store for "weather" is unmeasurable without credentials');
  });

  it("fails where the store was supposed to be reachable", () => {
    const result = checkFreshness(["--require-store"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FRESHNESS CHECK FAILED");
  });

  it("is in the pre-push gate", () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as
      Record<string, string>;
    expect(scripts.verify).toContain("check:freshness");
  });
});
