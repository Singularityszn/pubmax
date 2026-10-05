import { findBrand } from "@/lib/drinkBrands";
import { parseDrinkSubtypeParam } from "@/lib/drinkSubtypes";
import { categoryLabel, isMapLensDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import { drinkLensPriceNoun, drinkLensUnknownRowLabel, type CategoryPriceIndexStatus, type MapLensPrice } from "@/lib/mapExperienceLens";
import { selectedDrinkPriceDescription, selectedDrinkPriceEvidenceForPrice } from "@/lib/planSelectedDrinkPriceEvidence";
import type { Filters } from "@/lib/venues";
import type { InferredNightContext, NightContext } from "@/lib/nightPlanning";

export type MapPlanDrinkSelection = Pick<Filters, "drinkCategory" | "drinkSubtype" | "drinkBrand">
  & Partial<Pick<Filters, "topShelfOnly">>;

export type MapPlanDrinkPresentation = {
  category: DrinkCategory;
  label: string;
  priceNoun: string;
  stopNoun: string;
  refined: boolean;
};

/** Subtype labels that lead with a place or product name keep their capitals. */
const PROPER_NAME_SUBTYPES: ReadonlySet<string> = new Set([
  "whisky-irish",
  "whisky-japanese",
  "whisky-scotch",
  "gin-london-dry",
  "gin-old-tom",
  "soft-drink-coke-zero",
  "soft-drink-diet-coke",
  "soft-drink-pepsi-max",
  "soft-drink-diet-pepsi",
]);

/** The unrefined Beer lane keeps the existing pint presentation. */
export function mapPlanDrinkPresentation(
  selection?: MapPlanDrinkSelection,
): MapPlanDrinkPresentation | null {
  if (!selection) return null;
  const category = isMapLensDrinkCategory(selection.drinkCategory) ? selection.drinkCategory : "beer";
  const refined = Boolean(selection.drinkSubtype || selection.drinkBrand || selection.topShelfOnly);
  if (category === "beer" && !refined) return null;
  const subtype = parseDrinkSubtypeParam(selection.drinkSubtype, category);
  const brand = findBrand(selection.drinkBrand);
  const ownBrand = brand?.category === category ? brand.brand.label : null;
  const common = subtype?.longLabel ?? categoryLabel(category);
  const proper = ownBrand ?? (subtype && PROPER_NAME_SUBTYPES.has(subtype.id) ? subtype.longLabel : null);
  const noun = proper ?? sentenceCaseNoun(common);
  const label = selection.topShelfOnly ? `Top shelf ${noun}` : ownBrand ?? common;
  const priceNoun = drinkLensPriceNoun(category);
  const stopNoun = !refined ? priceNoun : selection.topShelfOnly ? `top shelf ${noun}` : noun;
  return { category, label, priceNoun, stopNoun: `${stopNoun} stop`, refined };
}

/** Lower a common noun mid-sentence, but keep acronyms such as IPA. */
function sentenceCaseNoun(noun: string): string {
  return /^[A-Z]{2}/.test(noun) ? noun : noun.charAt(0).toLowerCase() + noun.slice(1);
}

export function mapPlanDrinkPriceDescription(
  presentation: MapPlanDrinkPresentation,
  venueId: string,
  prices?: ReadonlyMap<string, MapLensPrice> | null,
  status: CategoryPriceIndexStatus = "idle",
): string {
  // Category reports have no brand, subtype, top-shelf or serving identity.
  if (presentation.refined) return `${presentation.label} price unknown here. Ask at the bar.`;
  const price = prices?.get(venueId);
  const evidence = price?.venueId === venueId
    ? selectedDrinkPriceEvidenceForPrice(price, { drinkCategory: presentation.category, zeroProof: false })
    : null;
  return selectedDrinkPriceDescription(evidence ?? undefined)
    ?? drinkLensUnknownRowLabel(presentation.priceNoun, status);
}

export function mapPlanDrinkDefaultContext(
  selection: MapPlanDrinkSelection | undefined,
  inferred: InferredNightContext,
  zeroProof: boolean,
): Partial<NightContext> {
  if (zeroProof || inferred.context.zeroProof || inferred.reasons.some((reason) => reason.field === "drinkCategory")) return {};
  const drink = mapPlanDrinkPresentation(selection);
  if (!drink) return {};
  if (drink.refined) {
    const choices = [
      selection?.drinkBrand ? "the brand" : null,
      selection?.drinkSubtype ? "the style" : null,
      selection?.topShelfOnly ? "Top shelf" : null,
    ].filter(Boolean).join(" and ");
    throw new Error(`The planner cannot match ${drink.label} yet. Turn off ${choices} on the map, or name a different drink.`);
  }
  return drink.category === "alcohol-free" ? { zeroProof: true } : { drinkCategory: drink.category };
}

/** Share only closed taxonomy values that agree with the selected category. */
export function appendMapPlanDrinkSelection(
  params: URLSearchParams,
  selection?: MapPlanDrinkSelection,
): void {
  if (!selection) return;
  const category = isMapLensDrinkCategory(selection.drinkCategory) ? selection.drinkCategory : "beer";
  const subtype = parseDrinkSubtypeParam(selection.drinkSubtype, category);
  const brand = findBrand(selection.drinkBrand);
  params.set("drink", category);
  if (subtype) params.set("sub", subtype.id);
  if (brand?.category === category) params.set("brand", brand.brand.id);
  if (selection.topShelfOnly) params.set("topshelf", "1");
}
