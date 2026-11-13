export function mergeOsmTwins(rows: ReadonlyArray<ReadonlyArray<unknown>>): {
  rows: unknown[][];
  twins: Map<string, string>;
};
