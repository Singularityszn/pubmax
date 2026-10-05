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
  const named = brand?.category === category
    ? brand.brand.label
    : subtype?.longLabel ?? categoryLabel(category);
  const label = selection.topShelfOnly
    ? `Top shelf ${named === categoryLabel(category) ? named.toLowerCase() : named}`
    : named;
  const priceNoun = refined ? label : drinkLensPriceNoun(category);
  return { category, label, priceNoun, stopNoun: `${priceNoun.toLowerCase()} stop`, refined };
}

export function mapPlanDrinkPriceDescription(
  presentation: MapPlanDrinkPresentation,
  venueId: string,
  prices?: ReadonlyMap<string, MapLensPrice> | null,
  status: CategoryPriceIndexStatus = "idle",
): string {
  // Category reports have no brand, subtype, top-shelf or serving identity.
  if (presentation.refined) return `${presentation.priceNoun} price not shown in plans`;
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
    throw new Error(`The planner cannot match ${drink.label} yet. Choose a drink lane without a brand or style, or name a different drink.`);
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
