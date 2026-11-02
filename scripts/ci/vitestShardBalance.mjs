// BALANCED UNIT SHARDS (docs/CI_RUNBOOK.md, "Timeouts and job shape").
//
// Vitest's own `--shard` sorts test files by a hash of their path and cuts the
// list into equal COUNTS. A few files carry most of the suite's time, so on CI
// run 41468260511 one of three shards held 1,052 seconds of tests and the
// others 532 and 622, and the slowest shard set the merge wait. This leaf
// gives every shard the same measured TIME instead: files are placed longest
// first, each on the shard with the least time so far (the longest-processing-
// time rule). A file the durations list does not know weighs the list's median,
// so a new test file still lands somewhere and is still run.
//
// Every shard runs this over the same file list and the same durations, so the
// shards agree on the split without talking to each other: each file is run
// exactly once across the shards. It reads nothing and writes nothing. Its
// types are in vitestShardBalance.d.mts; vitest.config.mts loads it as plain
// JavaScript, because the config is read before any TypeScript transform.

function normalise(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function medianDuration(durations) {
  const known = Object.values(durations)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  return known.length > 0 ? known[Math.floor(known.length / 2)] : 1;
}

export function balancedShards(items, pathOf, durations, count) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`shard count must be a positive integer, got ${count}`);
  const fallback = medianDuration(durations);
  const weighted = items
    .map((item) => {
      const path = normalise(pathOf(item));
      const known = durations[path];
      const weight = known !== undefined && Number.isFinite(known) && known > 0 ? known : fallback;
      return { item, path, weight };
    })
    // Longest first; equal weights break on the path, so every shard sorts alike.
    .sort((a, b) => b.weight - a.weight || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const loads = Array.from({ length: count }, () => 0);
  const shards = Array.from({ length: count }, () => []);
  for (const { item, weight } of weighted) {
    let lightest = 0;
    for (let index = 1; index < count; index += 1) {
      if (loads[index] < loads[lightest]) lightest = index;
    }
    loads[lightest] += weight;
    shards[lightest].push(item);
  }
  return shards;
}

export function balancedShard(items, pathOf, durations, index, count) {
  if (!Number.isInteger(index) || index < 1 || index > count) {
    throw new RangeError(`shard index must be 1 to ${count}, got ${index}`);
  }
  return balancedShards(items, pathOf, durations, count)[index - 1];
}
