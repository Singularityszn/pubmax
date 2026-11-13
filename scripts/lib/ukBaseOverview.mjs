const UK_BASE_OVERVIEW_VERSION = 1;
export const UK_BASE_OVERVIEW_BUDGET_BYTES = 32 * 1024;

/**
 * @param {{ urlPrefix: string, generatedFrom?: { count?: number } }} manifest
 * @param {Array<{ id: string, rows: unknown[] }>} shards
 */
export function buildUkBaseOverview(manifest, shards) {
  const cells = [];
  let count = 0;
  for (const shard of [...shards].sort((a, b) => a.id.localeCompare(b.id))) {
    let rows = 0;
    for (const row of shard.rows) {
      if (!Array.isArray(row) || !Number.isFinite(row[3]) || !Number.isFinite(row[4])) {
        throw new Error(`Shard ${shard.id} has a row with no position`);
      }
      rows += 1;
    }
    if (rows === 0) continue;
    cells.push([shard.rows[0][3], shard.rows[0][4], rows]);
    count += rows;
  }
  const expected = manifest.generatedFrom?.count;
  if (typeof expected === "number" && expected !== count) {
    throw new Error(`UK base overview counts ${count} rows, the manifest states ${expected}`);
  }
  return {
    version: UK_BASE_OVERVIEW_VERSION,
    urlPrefix: manifest.urlPrefix,
    count,
    cells,
  };
}
