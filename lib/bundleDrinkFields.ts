// Drink label + subtype fields on UK price bundle rows. Computed at bundle-build
// time from a lane's printed drink name; never guessed without label text.

import type { DrinkCategory } from "@/lib/drinks";
import { drinkSubtypeFromText, findSubtype } from "@/lib/drinkSubtypes";

export const UK_PRICE_BUNDLE_DRINK_LABEL_MAX = 80;

export function normalizeUkPriceBundleDrinkLabel(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= UK_PRICE_BUNDLE_DRINK_LABEL_MAX) return trimmed;
  return trimmed.slice(0, UK_PRICE_BUNDLE_DRINK_LABEL_MAX);
}

/** Classify a printed name into at most one closed subtype, or null. */
function ukPriceBundleDrinkSubtype(
  drinkLabel: string,
  category: string,
): string | null {
  const hit = drinkSubtypeFromText(drinkLabel, category as DrinkCategory);
  return hit?.id ?? null;
}

export function bundleDrinkFieldsFromPrintedName(
  printedName: string | null | undefined,
  category: string,
): { drinkLabel?: string; drinkSubtype?: string } {
  const drinkLabel = normalizeUkPriceBundleDrinkLabel(printedName);
  if (!drinkLabel) return {};
  const drinkSubtype = ukPriceBundleDrinkSubtype(drinkLabel, category);
  return drinkSubtype ? { drinkLabel, drinkSubtype } : { drinkLabel };
}

export function bundleRowDedupeDrinkKey(row: {
  drinkLabel?: string | null;
}): string {
  const label = typeof row.drinkLabel === "string" ? row.drinkLabel.trim().toLowerCase() : "";
  return label;
}

export function isValidBundleDrinkSubtypeForRow(
  category: string,
  drinkSubtype: unknown,
): boolean {
  if (drinkSubtype === undefined || drinkSubtype === null) return true;
  if (typeof drinkSubtype !== "string" || !drinkSubtype.trim()) return false;
  const hit = findSubtype(drinkSubtype);
  return hit !== null && hit.category === category;
}
