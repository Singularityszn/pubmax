export function rowsFromSlimPayload(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return null;
  const rows = (value as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  if ((value as { bundlePricesChecked?: unknown }).bundlePricesChecked !== true) return rows;
  return rows.map((item: unknown) => {
    if (typeof item !== "object" || item === null) return item;
    const row = item as Record<string, unknown>;
    return row.cheapestPrice === null && row.hasRecordedPrice === undefined
      ? { ...row, hasRecordedPrice: false }
      : row;
  });
}
