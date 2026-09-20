import type { DrinkCategory } from "@/lib/drinks";
import { DRINK_CATEGORIES } from "@/lib/drinks";

import { CATEGORY_PRICE_BANDS, type UkPriceDropReason } from "@/lib/harvest/ukPriceCrawl";

/** Text either side of a figure sent to TypeSafe (cookbook state). */
export const UK_PRICE_JUDGMENT_SNIPPET_CHARS = 120;

export const WHAT_IS_PRICED_OPTIONS = [
  "draught_pint",
  "half_pint",
  "bottle_or_can",
  "wine_glass",
  "spirit_or_cocktail",
  "soft_drink_or_coffee",
  "food_or_meal_deal",
  "not_a_menu_price",
] as const;

export type WhatIsPriced = (typeof WHAT_IS_PRICED_OPTIONS)[number];

export const DRINK_CATEGORY_JUDGMENT_OPTIONS = [...DRINK_CATEGORIES, "unclear"] as const;
export type DrinkCategoryJudgment = (typeof DRINK_CATEGORY_JUDGMENT_OPTIONS)[number];

export type UkPriceJudgmentProbabilities = {
  whatIsPriced: Record<WhatIsPriced, number>;
  isPromotionalPrice: number;
  drinkCategory: Record<DrinkCategoryJudgment, number>;
};

export type UkPriceJudgmentOutcome = "publish" | "review" | "reject";

export type UkPriceJudgmentDecision = {
  outcome: UkPriceJudgmentOutcome;
  drop?: UkPriceDropReason;
  category?: DrinkCategory;
};

// Thresholds from __tests__/fixtures/typesafe/pint-price-judgment-probabilities.json
export const DRAUGHT_PINT_PUBLISH_THRESHOLD = 0.72;
export const DRAUGHT_PINT_REVIEW_THRESHOLD = 0.42;
export const PROMOTIONAL_REJECT_THRESHOLD = 0.6;

const WHAT_TO_CATEGORY: Partial<Record<WhatIsPriced, DrinkCategory>> = {
  draught_pint: "beer",
  wine_glass: "wine",
  spirit_or_cocktail: "cocktail",
  soft_drink_or_coffee: "soft-drink",
};

function drinkCategoryFromJudgment(choice: DrinkCategoryJudgment): DrinkCategory | null {
  if (choice === "unclear" || choice === "other") return null;
  return choice;
}

function resolveCategory(
  whatIsPriced: WhatIsPriced,
  drinkCategory: DrinkCategoryJudgment,
): DrinkCategory | null {
  if (whatIsPriced === "spirit_or_cocktail") {
    const fromDrink = drinkCategoryFromJudgment(drinkCategory);
    if (fromDrink === "cocktail" || fromDrink === "gin" || fromDrink === "whisky" || fromDrink === "vodka" || fromDrink === "rum" || fromDrink === "shot") {
      return fromDrink;
    }
    return "cocktail";
  }
  if (whatIsPriced === "soft_drink_or_coffee") {
    const fromDrink = drinkCategoryFromJudgment(drinkCategory);
    if (fromDrink === "coffee") return "coffee";
    if (fromDrink === "alcohol-free") return "alcohol-free";
    if (fromDrink === "soft-drink") return "soft-drink";
    return "soft-drink";
  }
  if (whatIsPriced === "bottle_or_can") {
    const fromDrink = drinkCategoryFromJudgment(drinkCategory);
    return fromDrink ?? "beer";
  }
  return WHAT_TO_CATEGORY[whatIsPriced] ?? null;
}

function dropForWhatIsPriced(what: WhatIsPriced): UkPriceDropReason {
  switch (what) {
    case "half_pint":
      return "half-measure-not-a-pint";
    case "bottle_or_can":
      return "bottled-measure-not-a-pint";
    case "food_or_meal_deal":
      return "food-word-nearby";
    case "not_a_menu_price":
      return "offer-not-a-menu-price";
    default:
      return "no-category-word-nearby";
  }
}

/**
 * Turn one TypeSafe answer set into publish, human review, or a counted drop.
 * Plausibility bands and verbatim checks are applied by the caller after this.
 */
export function decisionFromJudgment(
  probs: UkPriceJudgmentProbabilities,
  priceGbp: number,
): UkPriceJudgmentDecision {
  if (probs.isPromotionalPrice >= PROMOTIONAL_REJECT_THRESHOLD) {
    return { outcome: "reject", drop: "offer-not-a-menu-price" };
  }

  const draughtProb = probs.whatIsPriced.draught_pint ?? 0;
  const topWhat = WHAT_IS_PRICED_OPTIONS.reduce((best, key) =>
    (probs.whatIsPriced[key] ?? 0) > (probs.whatIsPriced[best] ?? 0) ? key : best,
  );

  if (topWhat === "draught_pint") {
    if (draughtProb >= DRAUGHT_PINT_PUBLISH_THRESHOLD) {
      const band = CATEGORY_PRICE_BANDS.beer;
      if (!band || priceGbp < band.minGbp || priceGbp > band.maxGbp) {
        return { outcome: "reject", drop: "outside-category-band" };
      }
      return { outcome: "publish", category: "beer" };
    }
    if (draughtProb >= DRAUGHT_PINT_REVIEW_THRESHOLD) {
      return { outcome: "review" };
    }
    return { outcome: "reject", drop: "judgment-below-threshold" };
  }

  const category = resolveCategory(topWhat, DRINK_CATEGORY_JUDGMENT_OPTIONS.reduce((best, key) =>
    (probs.drinkCategory[key] ?? 0) > (probs.drinkCategory[best] ?? 0) ? key : best,
  ));

  if (category) {
    const band = CATEGORY_PRICE_BANDS[category];
    if (!band || priceGbp < band.minGbp || priceGbp > band.maxGbp) {
      return { outcome: "reject", drop: "outside-category-band" };
    }
    return { outcome: "publish", category };
  }

  return { outcome: "reject", drop: dropForWhatIsPriced(topWhat) };
}

export function probabilitiesFromAnswers(answers: {
  whatIsPriced: { probabilities: Record<string, number> };
  isPromotionalPrice: { noul: number };
  drinkCategory: { probabilities: Record<string, number> };
}): UkPriceJudgmentProbabilities {
  const whatIsPriced = {} as Record<WhatIsPriced, number>;
  for (const key of WHAT_IS_PRICED_OPTIONS) {
    whatIsPriced[key] = answers.whatIsPriced.probabilities[key] ?? 0;
  }
  const drinkCategory = {} as Record<DrinkCategoryJudgment, number>;
  for (const key of DRINK_CATEGORY_JUDGMENT_OPTIONS) {
    drinkCategory[key] = answers.drinkCategory.probabilities[key] ?? 0;
  }
  return {
    whatIsPriced,
    isPromotionalPrice: answers.isPromotionalPrice.noul,
    drinkCategory,
  };
}
