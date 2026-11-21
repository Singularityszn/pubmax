export function indexUkBeerEstimates(rows) {
  const result = new Map();
  for (const row of rows) {
    if (row.standing !== "estimate" || row.category !== "beer" || !Number.isInteger(row.sampleSize) || row.sampleSize < 3 ||
      !Number.isFinite(row.priceGbp) || row.priceGbp < 2 || row.priceGbp > 12 ||
      typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt)) || typeof row.basis !== "string") continue;
    const separator = row.basis.indexOf(":");
    if (separator < 0) continue;
    const basis = row.basis.slice(0, separator);
    const text = row.basis.slice(separator + 1);
    if (!text || !["nearby", "locality", "postcode_area", "nearest_region", "uk_median", "regional_baseline", "chain_menu"].includes(basis)) continue;
    const detail = basis === "nearby" ? Number(text) : text;
    if (basis === "nearby" && detail !== 2) continue;
    result.set(row.venueId, { priceGbp: row.priceGbp, basis, sampleSize: row.sampleSize, detail, computedAt: row.observedAt });
  }
  return result;
}
