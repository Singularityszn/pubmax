export function recordedPintVenueIdsFromSlimPayload(value: unknown): string[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const payload = value as { bundlePricesChecked?: unknown; recordedPintVenueIds?: unknown; rows?: unknown };
  if (payload.bundlePricesChecked !== true) return undefined;
  if (payload.recordedPintVenueIds !== undefined) {
    return Array.isArray(payload.recordedPintVenueIds) && payload.recordedPintVenueIds.every((id) => typeof id === "string")
      ? payload.recordedPintVenueIds : undefined;
  }
  // Older published packs carry the same availability on individual rows.
  return Array.isArray(payload.rows) ? payload.rows.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as { id?: unknown; hasRecordedPrice?: unknown };
    return row.hasRecordedPrice === true && typeof row.id === "string" ? [row.id] : [];
  }) : undefined;
}

export function rowsFromSlimPayload(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return null;
  const rows = (value as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  const recordedIds = recordedPintVenueIdsFromSlimPayload(value);
  if (!recordedIds) return rows;
  const recorded = new Set(recordedIds);
  return rows.map((item: unknown) => {
    if (typeof item !== "object" || item === null) return item;
    const row = item as Record<string, unknown>;
    return row.cheapestPrice === null && row.hasRecordedPrice === undefined
      ? { ...row, hasRecordedPrice: typeof row.id === "string" && recorded.has(row.id) }
      : row;
  });
}
