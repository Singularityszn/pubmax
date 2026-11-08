type Row = Record<string, unknown>;

export function billTable(rows: Row[]) {
  const predicates: Array<(row: Row) => boolean> = [];
  let values: Row | undefined;
  let columns = "*";
  let count = Infinity;
  const execute = () => ({
    data: rows.filter((row) => predicates.every((predicate) => predicate(row)))
      .slice(0, count).map((row) => {
        if (values) Object.assign(row, values);
        return columns === "*" ? { ...row } : Object.fromEntries(
          columns.split(",").map((column) => [column.trim(), row[column.trim()]]),
        );
      }),
    error: null,
  });
  const query = {
    update(next: Row) { values = next; return query; },
    select(next: string) { columns = next; return query; },
    eq(column: string, value: unknown) {
      predicates.push((row) => row[column] === value);
      return query;
    },
    is(column: string, value: unknown) {
      predicates.push((row) => row[column] === value);
      return query;
    },
    not(column: string, operator: string, value: unknown) {
      if (operator !== "is") throw new Error(`Unsupported operator: ${operator}`);
      predicates.push((row) => row[column] !== value);
      return query;
    },
    limit(next: number) { count = next; return query; },
    then(resolve: (value: ReturnType<typeof execute>) => unknown) {
      return Promise.resolve(execute()).then(resolve);
    },
  };
  return query;
}
