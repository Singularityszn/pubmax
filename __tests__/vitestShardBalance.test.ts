// The CI unit shards split the suite by measured time, not by count
// (scripts/ci/vitestShardBalance.mjs; docs/CI_RUNBOOK.md, "Timeouts and job
// shape"). A shard that leaves a file out, or two that both run it, would
// turn a green run into a false one, so every split here is checked for
// exactly-once coverage before it is checked for balance.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { balancedShard, balancedShards, type ShardDurations } from "@/scripts/ci/vitestShardBalance.mjs";

const ROOT = process.cwd();
const durations = (
  JSON.parse(readFileSync(join(ROOT, "scripts/ci/vitest-shard-durations.json"), "utf8")) as {
    unit: string;
    files: ShardDurations;
  }
);

function testFiles(): string[] {
  return readdirSync(join(ROOT, "__tests__"))
    .filter((name) => /\.test\.tsx?$/.test(name))
    .map((name) => `__tests__/${name}`)
    .sort();
}

const load = (files: readonly string[], weights: ShardDurations, fallback: number) =>
  files.reduce((sum, file) => sum + (weights[file] ?? fallback), 0);

describe("balanced unit shards", () => {
  it("runs every file exactly once across the shards, whatever the count", () => {
    const files = testFiles();
    for (const count of [1, 2, 3, 4, 7]) {
      const shards = balancedShards(files, (file) => file, durations.files, count);
      expect(shards).toHaveLength(count);
      const seen = shards.flat();
      expect(seen.length, `count ${count}`).toBe(files.length);
      expect(new Set(seen).size, `count ${count}`).toBe(files.length);
      expect([...seen].sort()).toEqual(files);
    }
  });

  it("gives every shard the same split from the same inputs, in any input order", () => {
    const files = testFiles();
    const reversed = [...files].reverse();
    for (const index of [1, 2, 3]) {
      expect(balancedShard(reversed, (file) => file, durations.files, index, 3).sort()).toEqual(
        balancedShard(files, (file) => file, durations.files, index, 3).sort(),
      );
    }
  });

  it("evens out the measured suite across three shards", () => {
    const files = Object.keys(durations.files);
    const loads = balancedShards(files, (file) => file, durations.files, 3).map((shard) =>
      load(shard, durations.files, 0),
    );
    const longest = Math.max(...Object.values(durations.files));
    // Longest-first placement keeps every shard within one file of the others.
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(longest);
    expect(Math.max(...loads) / Math.min(...loads)).toBeLessThan(1.1);
  });

  it("still runs a file the durations list has never seen, at the median weight", () => {
    const weights = { "__tests__/a.test.ts": 100, "__tests__/b.test.ts": 300, "__tests__/c.test.ts": 200 };
    const files = [...Object.keys(weights), "__tests__/new.test.ts"];
    const shards = balancedShards(files, (file) => file, weights, 2);
    expect(shards.flat().sort()).toEqual([...files].sort());
    // Longest first: b (300) opens shard 1, c (200) opens shard 2, the
    // newcomer weighs the median (200) and joins the lighter shard 2, and a
    // (100) evens shard 1: 400 against 400.
    expect(shards.map((shard) => shard.sort())).toEqual([
      ["__tests__/a.test.ts", "__tests__/b.test.ts"],
      ["__tests__/c.test.ts", "__tests__/new.test.ts"],
    ]);
  });

  it("refuses a shard index or count the CI matrix could not mean", () => {
    expect(() => balancedShards(["x"], (file) => file, {}, 0)).toThrow(RangeError);
    expect(() => balancedShard(["x"], (file) => file, {}, 0, 3)).toThrow(RangeError);
    expect(() => balancedShard(["x"], (file) => file, {}, 4, 3)).toThrow(RangeError);
  });

  it("keeps the durations list in milliseconds for files that exist", () => {
    expect(durations.unit).toBe("milliseconds");
    const existing = new Set(testFiles());
    const listed = Object.keys(durations.files);
    expect(listed.length).toBeGreaterThan(0);
    for (const file of listed) {
      expect(Number.isFinite(durations.files[file]), file).toBe(true);
      expect(durations.files[file], file).toBeGreaterThanOrEqual(0);
    }
    // A deleted test file leaves a stale row that weighs nothing at run time;
    // most of the list must still name real files, or it is time to refresh it
    // with `npm run ci:shard-durations`.
    const live = listed.filter((file) => existing.has(file)).length;
    expect(live / listed.length).toBeGreaterThan(0.9);
  });

  it("is the sequencer the Vitest config uses", () => {
    const config = readFileSync(join(ROOT, "vitest.config.mts"), "utf8");
    expect(config).toContain("sequence: { sequencer: DurationBalancedSequencer }");
    expect(config).toContain("balancedShard(files, (spec) => relative(root, spec.moduleId), SHARD_DURATIONS, shard.index, shard.count)");
  });
});
