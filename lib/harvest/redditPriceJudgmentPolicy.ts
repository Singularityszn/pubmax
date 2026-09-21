import type { DrinkCategory } from "@/lib/drinks";
import { decisionFromJudgment, type UkPriceJudgmentProbabilities } from "@/lib/harvest/ukPriceJudgmentPolicy";

/** From __tests__/fixtures/typesafe/reddit-price-judgment-probabilities.json */
export const REDDIT_ACTUAL_PRICE_PUBLISH_THRESHOLD = 0.72;
export const REDDIT_ACTUAL_PRICE_REVIEW_THRESHOLD = 0.42;

export type RedditPriceJudgmentProbabilities = {
  isActualPriceReport: number;
  drinkJudgment: UkPriceJudgmentProbabilities;
};

export type RedditJudgmentOutcome = "publish" | "review" | "reject";

export function redditDecisionFromJudgment(
  probs: RedditPriceJudgmentProbabilities,
  priceGbp: number,
): { outcome: RedditJudgmentOutcome; drinkCategory?: DrinkCategory; confidence: number } {
  const actual = probs.isActualPriceReport ?? 0;
  if (actual < REDDIT_ACTUAL_PRICE_REVIEW_THRESHOLD) {
    return { outcome: "reject", confidence: actual };
  }
  const drinkDecision = decisionFromJudgment(probs.drinkJudgment, priceGbp);
  if (drinkDecision.outcome === "reject") {
    return { outcome: "reject", confidence: actual };
  }
  if (actual < REDDIT_ACTUAL_PRICE_PUBLISH_THRESHOLD || drinkDecision.outcome === "review") {
    return { outcome: "review", confidence: actual };
  }
  if (drinkDecision.outcome === "publish" && drinkDecision.category) {
    return { outcome: "publish", drinkCategory: drinkDecision.category, confidence: actual };
  }
  return { outcome: "review", confidence: actual };
}

export function keylessRedditJudgment(snippet: string): RedditPriceJudgmentProbabilities {
  const paid = /\b(paid|cost|was|charged|got|buy|bought)\b/i.test(snippet);
  const hypothetical = /\b(wish|would be|remember when|if only)\b/i.test(snippet) && !paid;
  const actualScore = hypothetical ? 0.2 : paid ? 0.78 : 0.35;
  return {
    isActualPriceReport: actualScore,
    drinkJudgment: {
      whatIsPriced: {
        draught_pint: /\b(pint|guinness|lager|ale|stout|cider)\b/i.test(snippet) ? 0.85 : 0.1,
        half_pint: 0,
        bottle_or_can: 0,
        wine_glass: /\bwine\b/i.test(snippet) ? 0.75 : 0,
        spirit_or_cocktail: /\b(cocktail|gin|whisky|vodka|rum)\b/i.test(snippet) ? 0.7 : 0,
        soft_drink_or_coffee: 0,
        food_or_meal_deal: 0,
        not_a_menu_price: 0,
      },
      isPromotionalPrice: /\b(2 for|happy hour|deal)\b/i.test(snippet) ? 0.8 : 0.05,
      drinkCategory: {
        beer: /\b(pint|guinness|lager|ale|stout|cider)\b/i.test(snippet) ? 0.9 : 0.5,
        wine: 0,
        whisky: 0,
        gin: 0,
        vodka: 0,
        rum: 0,
        cocktail: 0,
        shot: 0,
        "alcohol-free": 0,
        "soft-drink": 0,
        coffee: 0,
        other: 0,
        unclear: 0,
      },
    },
  };
}
