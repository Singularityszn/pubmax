import { listedPriceExpired } from "@/lib/priceTier";
import { expandFairPintPin } from "@/lib/slimListingPrices.mjs";

/**
 * Every reader of a slim index gets its price through here, so this is where a
 * listed figure past its window stops being a current price (lib/priceTier.ts).
 * The figure moves to `oldListedPrice`, and the pub keeps its estimate. A pub
 * with a current figure carries no estimate, as it always has.
 */
export function withCurrentListing(value: unknown, now: number): unknown {
  if (typeof value !== "object" || value === null) return value;
  const row = value as Record<string, unknown>;
  if (typeof row.cheapestPrice !== "number" || row.anchorLabel !== undefined) return value;
  const out = { ...row };
  if (!listedPriceExpired(row.priceObservedAt as string | undefined, now)) {
    delete out.estimate;
    return out;
  }
  for (const field of ["cheapestPint", "measure", "priceSource", "priceObservedAt", "fairPint"]) delete out[field];
  const source = typeof row.priceSource === "string" ? row.priceSource.trim() : "";
  return {
    ...out,
    cheapestPrice: null,
    oldListedPrice: { priceGbp: row.cheapestPrice, observedAt: row.priceObservedAt, publisher: source || null },
  };
}

export function recordedPintVenueIdsFromSlimPayload(value: unknown): string[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const payload = value as { bundlePricesChecked?: unknown; recordedPintVenueIds?: unknown };
  if (payload.bundlePricesChecked !== true) return undefined;
  return Array.isArray(payload.recordedPintVenueIds) && payload.recordedPintVenueIds.every((id) => typeof id === "string")
    ? payload.recordedPintVenueIds : undefined;
}

/**
 * The slim rows a reader may use. `now` is the instant a listing is judged at;
 * null hands back the rows as shipped, for a cache that judges them per read.
 */
export function rowsFromSlimPayload(value: unknown, now: number | null = Date.now()): unknown[] | null {
  const current = (row: unknown) => (now === null ? row : withCurrentListing(row, now));
  if (Array.isArray(value)) return value.map(current);
  if (typeof value !== "object" || value === null) return null;
  const metadata = value as { rows?: unknown; ft?: unknown; fu?: unknown };
  const rows = metadata.rows;
  if (!Array.isArray(rows)) return null;
  const recordedIds = recordedPintVenueIdsFromSlimPayload(value);
  if (!recordedIds) return rows.map((row) => current(expandFairPintPin(row, metadata)));
  const recorded = new Set(recordedIds);
  return rows.map((item: unknown) => {
    if (typeof item !== "object" || item === null) return item;
    const row = current(expandFairPintPin(item, metadata)) as Record<string, unknown>;
    return row.cheapestPrice === null && row.hasRecordedPrice === undefined
      ? { ...row, hasRecordedPrice: typeof row.id === "string" && recorded.has(row.id) }
      : row;
  });
}
