import { isMapLensDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import { drinkSubtypeFromText, drinkSubtypeMembers, parseDrinkSubtypeParam } from "@/lib/drinkSubtypes";

/** A subtype price needs a named drink from its own closed family. */
export function listedDrinkMatchesSubtype(
  category: DrinkCategory,
  drinkLabel: string | null | undefined,
  drinkSubtype: string | null | undefined,
): boolean {
  const selected = parseDrinkSubtypeParam(drinkSubtype, category);
  if (!selected) return true;
  const named = drinkSubtypeFromText(drinkLabel, category);
  return named !== null && drinkSubtypeMembers(selected).some((member) => member.id === named.id);
}

/** Exact serving groups for listed drink quotes. Unknown serves carry no price rank. */
export function listedServingComparisonKey(
  category: string,
  servingSize: string | null | undefined,
  drinkSubtype?: string | null,
): string | null {
  if (!isMapLensDrinkCategory(category) || typeof servingSize !== "string") {
    return null;
  }
  // Generic beer keeps the resting pint lane. Only an explicit beer subtype
  // compares its own source-stated pint or exact volume.
  if (category === "beer") {
    if (!parseDrinkSubtypeParam(drinkSubtype, category)) return null;
    if (/^pint$/i.test(servingSize.trim())) return "beer:pint";
  }
  // A bottle label does not prove volume. Mixed measures and drink names cannot
  // be normalised into one price group either.
  const match = /^([1-9]\d{0,3})\s*ml(?:\s+(?:glass|shot))?$/i.exec(servingSize.trim());
  return match ? `${category}:${Number(match[1])}ml` : null;
}

/** Canonical source-stated serving, shared by query choices and comparison. */
export function listedServingGroup(category: string, serving: string | null | undefined, drinkSubtype?: string | null): string | null {
  const key = listedServingComparisonKey(category, serving, drinkSubtype);
  return key ? key.slice(key.indexOf(":") + 1) : null;
}

/** Existing state maps keep each category, subtype and serving read independent. */
export function drinkCategoryIndexKey(category: string, serving?: string | null, drinkSubtype?: string | null): string {
  const subtype = isMapLensDrinkCategory(category) ? parseDrinkSubtypeParam(drinkSubtype, category) : null;
  const group = listedServingGroup(category, serving, subtype?.id);
  const key = group ? `${category}:${group}` : category;
  return subtype ? `${key}:sub:${subtype.id}` : key;
}
