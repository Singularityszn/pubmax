import { isMapLensDrinkCategory } from "@/lib/drinks";

/** Exact serving groups for listed drink quotes. Unknown serves carry no price rank. */
export function listedServingComparisonKey(
  category: string,
  servingSize: string | null | undefined,
): string | null {
  if (!isMapLensDrinkCategory(category) || category === "beer" || typeof servingSize !== "string") {
    return null;
  }
  // A bottle label does not prove volume. Mixed measures and drink names cannot
  // be normalised into one price group either.
  const match = /^([1-9]\d{0,3})\s*ml(?:\s+(?:glass|shot))?$/i.exec(servingSize.trim());
  return match ? `${category}:${Number(match[1])}ml` : null;
}

/** Canonical source-stated volume, shared by query choices and comparison. */
export function listedServingGroup(category: string, serving: string | null | undefined): string | null {
  const key = listedServingComparisonKey(category, serving);
  return key ? key.slice(key.indexOf(":") + 1) : null;
}

/** Existing per-category state maps keep each explicit serving read independent. */
export function drinkCategoryIndexKey(category: string, serving?: string | null): string {
  const group = listedServingGroup(category, serving);
  return group ? `${category}:${group}` : category;
}
