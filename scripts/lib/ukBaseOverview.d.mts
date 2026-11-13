export declare const UK_BASE_OVERVIEW_BUDGET_BYTES: number;

export declare function buildUkBaseOverview(
  manifest: { urlPrefix: string; generatedFrom?: { count?: number } },
  shards: ReadonlyArray<{ id: string; rows: readonly unknown[] }>,
): {
  version: 1;
  urlPrefix: string;
  count: number;
  cells: Array<[number, number, number]>;
};
