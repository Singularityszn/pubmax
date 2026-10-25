import { LISTED_MAX_AGE_DAYS } from "@/lib/priceTier";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { namedNonBeerBundleUpdates } from "@/lib/venuePriceUpdates";

export type ListedMapDrinkCoverageRow = { venueId: string; category: "coffee" | "alcohol-free"; observedAt: string };

/** A compact listing index keeps menu claims separate from drinker confirmation. */
export function listedMapDrinkCoverageRows(rows: readonly UkPriceBundleRow[], now = Date.now()): ListedMapDrinkCoverageRow[] {
  const byPubAndCategory = new Map<string, ListedMapDrinkCoverageRow>();
  for (const row of namedNonBeerBundleUpdates(rows, now)) {
    const key = `${row.venueKey}:${row.category}`;
    const held = byPubAndCategory.get(key);
    if (!held || row.observedAt > held.observedAt) {
      byPubAndCategory.set(key, { venueId: row.venueKey, category: row.category as ListedMapDrinkCoverageRow["category"], observedAt: row.observedAt });
    }
  }
  return [...byPubAndCategory.values()];
}

/** The browser rechecks dates because a deployed index also ages. */
export function loadedListedDrinkCoverage(raw: unknown, venueIds: readonly string[], category: string, now = Date.now()): { count: number; newest: string | null } {
  if (!Array.isArray(raw)) throw new Error("Listed coverage is not an array");
  const loaded = new Set(venueIds);
  const pubs = new Set<string>();
  let newest: string | null = null;
  for (const value of raw) {
    if (!value || typeof value.venueId !== "string" || typeof value.observedAt !== "string" || !["coffee", "alcohol-free"].includes(value.category)) throw new Error("Invalid listed coverage row");
    const age = now - Date.parse(value.observedAt);
    if (value.category !== category || !loaded.has(value.venueId) || !Number.isFinite(age) || age < 0 || age > LISTED_MAX_AGE_DAYS * 86400000) continue;
    pubs.add(value.venueId);
    if (!newest || value.observedAt > newest) newest = value.observedAt;
  }
  return { count: pubs.size, newest };
}
