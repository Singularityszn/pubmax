import "server-only";

import { choice, noul } from "@typesafe-ai/sdk";

import { systemOne } from "@/lib/ai/typesafe.server";
import { DRINK_CATEGORIES } from "@/lib/drinks";
import {
  DRINK_CATEGORY_JUDGMENT_OPTIONS,
  UK_PRICE_JUDGMENT_SNIPPET_CHARS,
  WHAT_IS_PRICED_OPTIONS,
  decisionFromJudgment,
  probabilitiesFromAnswers,
  type UkPriceJudgmentProbabilities,
} from "@/lib/harvest/ukPriceJudgmentPolicy";
import {
  findUkPriceCandidates,
  pageText,
  readVenueDrinkPrices,
  type UkPriceCandidate,
  type UkPriceDropReason,
  type UkPriceReading,
} from "@/lib/harvest/ukPriceCrawl";

export type UkPriceJudgmentReviewRow = {
  pubName: string;
  pageUrl: string;
  snippet: string;
  priceText: string;
  priceGbp: number;
  probabilities: UkPriceJudgmentProbabilities;
};

export type UkPriceJudgedReading = UkPriceReading & {
  review: UkPriceJudgmentReviewRow[];
};

const drinkCategoryCriteria = Object.fromEntries(
  DRINK_CATEGORY_JUDGMENT_OPTIONS.map((label) => [
    label,
    label === "unclear"
      ? "The snippet names a drink but not which category it belongs to"
      : `The priced item is best labelled ${label} in the pub's menu taxonomy`,
  ]),
) as Record<string, string>;

const whatIsPricedCriteria = {
  draught_pint: {
    what: "A standard single pour of draught beer, cider or stout sold as a pint or as the main glass on a tap line",
    not_for: "A half, a bottle, a wine glass, food, or promotional copy",
  },
  half_pint: {
    what: "A half pint or the smaller figure on a half-and-pint pair",
    not_for: "A full pint price or a bottle",
  },
  bottle_or_can: {
    what: "A packaged beer, cider, or soft drink sold by the bottle or can",
    not_for: "A draught pint poured on tap",
  },
  wine_glass: {
    what: "Wine, prosecco or champagne sold by the glass (175ml, 250ml, large glass)",
    not_for: "A pint of beer or a cocktail",
  },
  spirit_or_cocktail: {
    what: "A spirit serve, shot, or mixed cocktail with one menu price",
    not_for: "A meal deal or a draught pint",
  },
  soft_drink_or_coffee: {
    what: "A non-alcoholic soft drink, mixer, or coffee with one menu price",
    not_for: "A draught pint or a spirit serve priced as one drink",
  },
  food_or_meal_deal: {
    what: "Food, a meal bundle, or a plate where the figure is not the price of one drink alone",
    not_for: "A drinks-list line naming one drink",
  },
  not_a_menu_price: {
    what: "Page furniture, delivery fees, deposits, ranges, or offer copy that is not one drink's menu price",
    not_for: "A line on a drinks list stating what one drink costs today",
  },
};

function ukPriceQuestions() {
  const drinkLabels = DRINK_CATEGORIES.join(", ");
  return {
    whatIsPriced: choice(
      {
        question:
          "Given `snippet` and `priceText` on a pub drinks page, what single item does this figure price?",
        inspect: "snippet",
        focus: "Use the words beside the figure only, not offers or headings elsewhere on the page.",
      },
      whatIsPricedCriteria,
    ),
    isPromotionalPrice: noul({
      question:
        "Is `priceText` in `snippet` a promotional, happy-hour, bundle, multi-buy, or 'from' price rather than the standard menu price for one item?",
      inspect: "snippet",
      focus: "Multi-buy (two for £X), happy hour, 'only', 'from', and meal bundles count as promotional.",
    }),
    drinkCategory: choice(
      {
        question: `When the priced item is a drink, which category fits best? Choose unclear only when the snippet does not name the drink type. Categories: ${drinkLabels}.`,
        inspect: "snippet",
      },
      drinkCategoryCriteria,
    ),
  };
}

export type UkPriceJudgmentState = {
  pubName: string;
  pageUrl: string;
  snippet: string;
  priceText: string;
};

export async function judgeUkPriceCandidate(
  state: UkPriceJudgmentState,
): Promise<UkPriceJudgmentProbabilities | null> {
  const response = await systemOne(state, ukPriceQuestions(), { lane: "typesafe" });
  if (!response) return null;
  return probabilitiesFromAnswers(response.answers);
}

export async function readVenueDrinkPricesJudged(
  html: string,
  ctx: { pubName: string; pageUrl: string },
): Promise<UkPriceJudgedReading> {
  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    return { ...readVenueDrinkPrices(html), review: [] };
  }

  const text = pageText(html);
  const candidates = findUkPriceCandidates(text, UK_PRICE_JUDGMENT_SNIPPET_CHARS);
  if (candidates.length === 0) {
    return { kept: [], drops: ["no-price-on-page"], review: [] };
  }

  const kept: UkPriceCandidate[] = [];
  const drops: UkPriceDropReason[] = [];
  const review: UkPriceJudgmentReviewRow[] = [];

  for (const raw of candidates) {
    if (!text.includes(raw.verbatim)) {
      drops.push("not-verbatim-on-page");
      continue;
    }

    const probs = await judgeUkPriceCandidate({
      pubName: ctx.pubName,
      pageUrl: ctx.pageUrl,
      snippet: raw.snippet,
      priceText: raw.priceText,
    });

    if (!probs) {
      return { ...readVenueDrinkPrices(html), review: [] };
    }

    const decision = decisionFromJudgment(probs, raw.priceGbp);
    if (decision.outcome === "review") {
      drops.push("judgment-needs-review");
      review.push({
        pubName: ctx.pubName,
        pageUrl: ctx.pageUrl,
        snippet: raw.snippet,
        priceText: raw.priceText,
        priceGbp: raw.priceGbp,
        probabilities: probs,
      });
      continue;
    }
    if (decision.outcome === "reject") {
      drops.push(decision.drop ?? "judgment-below-threshold");
      continue;
    }
    if (decision.category) {
      kept.push({
        priceGbp: raw.priceGbp,
        category: decision.category,
        verbatim: raw.verbatim,
        context: raw.snippet,
      });
    }
  }

  return { kept, drops, review };
}
