// Select UK price bundle rows by drink subtype for ranked views and map legend.

import { findSubtype } from "@/lib/drinkSubtypes";
import { standingCarriesAuthority } from "@/lib/priceTier";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

/** Rows whose classifier stamped the given subtype id. */
export function bundleRowsForSubtype(
  rows: readonly UkPriceBundleRow[],
  subtypeId: string,
): UkPriceBundleRow[] {
  const subtype = findSubtype(subtypeId);
  if (!subtype) return [];
  return rows.filter(
    (row) =>
      row.drinkSubtype === subtype.id &&
      row.category === subtype.category,
  );
}

/** Listed bundle rows a surface may treat as observed prices for this subtype. */
export function authoritativeBundleRowsForSubtype(
  rows: readonly UkPriceBundleRow[],
  subtypeId: string,
): UkPriceBundleRow[] {
  return bundleRowsForSubtype(rows, subtypeId).filter((row) =>
    standingCarriesAuthority(row.standing),
  );
}

/** Distinct venues with at least one authoritative bundle row for the subtype. */
export function countBundleVenuesForSubtype(
  rows: readonly UkPriceBundleRow[],
  subtypeId: string,
): number {
  const venueIds = new Set<string>();
  for (const row of authoritativeBundleRowsForSubtype(rows, subtypeId)) {
    venueIds.add(row.venueId);
  }
  return venueIds.size;
}

/** Distinct venues with any zero-sugar cola family row in the bundle. */
export function countBundleVenuesForZeroSugarColaFamily(
  rows: readonly UkPriceBundleRow[],
  familySubtypeIds: readonly string[],
): number {
  const venueIds = new Set<string>();
  for (const subtypeId of familySubtypeIds) {
    for (const row of authoritativeBundleRowsForSubtype(rows, subtypeId)) {
      venueIds.add(row.venueId);
    }
  }
  return venueIds.size;
}
