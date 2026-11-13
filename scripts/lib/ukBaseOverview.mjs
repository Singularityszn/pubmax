// The overview the map draws below the base layer's zoom gate. One point per
// published shard: the mean position of its rows and how many rows it holds.
// lib/ukBaseOverview.ts owns the client half and the file shape.

const UK_BASE_OVERVIEW_VERSION = 1;
export const UK_BASE_OVERVIEW_BUDGET_BYTES = 32 * 1024;

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * @param {{ urlPrefix: string, generatedFrom?: { count?: number } }} manifest
 * @param {Array<{ id: string, rows: unknown[] }>} shards
 */
export function buildUkBaseOverview(manifest, shards) {
  const cells = [];
  let count = 0;
  for (const shard of [...shards].sort((a, b) => a.id.localeCompare(b.id))) {
    let lat = 0;
    let lng = 0;
    let rows = 0;
    for (const row of shard.rows) {
      if (!Array.isArray(row) || !Number.isFinite(row[3]) || !Number.isFinite(row[4])) {
        throw new Error(`Shard ${shard.id} has a row with no position`);
      }
      lat += row[3];
      lng += row[4];
      rows += 1;
    }
    if (rows === 0) continue;
    cells.push([round3(lat / rows), round3(lng / rows), rows]);
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
