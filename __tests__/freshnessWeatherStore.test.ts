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

const ROOT = process.cwd();

type Dataset = {
  id: string;
  artifact: string | null;
  artifactRole?: string;
  stamp: { kind: string; feedKey?: string; pointer?: string } | null;
  stalenessBudgetHours: number | null;
};

function registry(): { datasets: Dataset[] } {
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

  it("passes with no store credentials, and never calls an unmeasured feed fresh", () => {
    const result = checkFreshness([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("UNRESOLVED");
    expect(result.stdout).toContain('Durable store for "weather" is unmeasurable');
    expect(result.stdout).toContain("They are NOT reported fresh");
    expect(result.stdout).not.toContain("FRESHNESS CHECK FAILED");
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
