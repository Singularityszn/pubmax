/** Durations in milliseconds, keyed by repo-relative test path with `/`. */
export type ShardDurations = Readonly<Record<string, number>>;

/** Every shard's files, in shard order; shard `i` is `result[i - 1]`. */
export declare function balancedShards<T>(
  items: readonly T[],
  pathOf: (item: T) => string,
  durations: ShardDurations,
  count: number,
): T[][];

/** The files shard `index` (1-based) of `count` runs. */
export declare function balancedShard<T>(
  items: readonly T[],
  pathOf: (item: T) => string,
  durations: ShardDurations,
  index: number,
  count: number,
): T[];
