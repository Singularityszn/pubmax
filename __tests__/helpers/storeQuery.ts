type Row = Record<string, unknown>;

type QueryState = {
  op: string;
  patch: Row | null;
  filters: ((row: Row) => boolean)[];
};

export function createStoreQuery(state: QueryState, run: () => unknown): Record<string, unknown> {
  const query: Record<string, unknown> = {
    select: () => query,
    update(patch: Row) {
      state.op = "update";
      state.patch = patch;
      return query;
    },
    eq(column: string, value: unknown) {
      state.filters.push((row) => row[column] === value);
      return query;
    },
    in(column: string, values: unknown[]) {
      state.filters.push((row) => values.includes(row[column]));
      return query;
    },
    order: () => query,
    limit: () => query,
    then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
      return Promise.resolve(run()).then(resolve, reject);
    },
  };
  return query;
}
