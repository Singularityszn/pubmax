#!/usr/bin/env node
// BALANCED LAYOUT-PIN SHARDS (docs/CI_RUNBOOK.md, "Timeouts and job shape").
//
// Playwright's `--shard` cuts the test list into equal COUNTS, and the slow
// map specs sit together at the end of its order, so the third layout shard
// ran two to three times longer than the other two. This prints the spec files
// one shard runs, chosen by measured time from layout-pin-durations.json with
// the same longest-first rule as the unit shards (vitestShardBalance.mjs). A
// spec the durations list does not know weighs the list's median.
//
// Usage: node scripts/ci/layout-pin-shard.mjs <index> <count> <spec...>
// Every shard passes the same spec list, so the shards agree on the split and
// each spec runs exactly once. It exits non-zero rather than print an empty
// shard, because Playwright given no file filter runs every spec it knows.

import { readFileSync } from "node:fs";

import { balancedShard } from "./vitestShardBalance.mjs";

const [index, count, ...specs] = process.argv.slice(2);
const { files: durations } = JSON.parse(readFileSync(new URL("./layout-pin-durations.json", import.meta.url), "utf8"));

const shard = balancedShard(specs, (spec) => spec, durations, Number(index), Number(count));
if (shard.length === 0) {
  console.error(`layout-pin-shard: shard ${index}/${count} of ${specs.length} spec(s) is empty`);
  process.exit(1);
}
console.log(shard.join(" "));
