import "server-only";

import { choice, noul, type Questions } from "@typesafe-ai/sdk";

import { systemOneOutcome, type SystemOneOutcome } from "@/lib/ai/typesafe.server";
import { DRINK_CATEGORIES } from "@/lib/drinks";
import { batchUkPriceCandidates } from "@/lib/harvest/ukPriceJudgmentBatch";
import {
  DRINK_CATEGORY_JUDGMENT_OPTIONS,
  UK_PRICE_JUDGMENT_SNIPPET_CHARS,
  decisionFromJudgment,
  probabilitiesFromBatchIndex,
  type UkPriceJudgmentProbabilities,
} from "@/lib/harvest/ukPriceJudgmentPolicy";
import {
  coffeeLineExcluded,
  drinkLabelFromPriceContext,
  findUkPriceCandidates,
  pageText,
  readKeylessUkPriceDecisions,
  readVenueDrinkPrices,
  statedWineIdentity,
  type UkPriceCandidate,
  type UkPriceDropReason,
  type UkPriceRawCandidate,
  type UkPriceReading,
  type UkPriceSourceFormat,
} from "@/lib/harvest/ukPriceCrawl";

type UkPriceJudgmentReviewRow = {
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

function ukPriceQuestionsForBatch(candidateCount: number): Questions {
  const drinkLabels = DRINK_CATEGORIES.join(", ");
  const questions: Questions = {};
  for (let index = 0; index < candidateCount; index += 1) {
    questions[`whatIsPriced_${index}`] = choice(
      {
        question: `For candidate ${index} on this page, given \`candidates[${index}].snippet\` and \`candidates[${index}].priceText\`, what single item does this figure price?`,
        inspect: `candidates[${index}].snippet`,
        focus: "Use the words beside the figure only, not offers or headings elsewhere on the page.",
      },
      whatIsPricedCriteria,
    );
    questions[`isPromotionalPrice_${index}`] = noul({
      question: `For candidate ${index}, is \`candidates[${index}].priceText\` in \`candidates[${index}].snippet\` a promotional, happy-hour, bundle, multi-buy, or 'from' price rather than the standard menu price for one item?`,
      inspect: `candidates[${index}].snippet`,
      focus: "Multi-buy (two for £X), happy hour, 'only', 'from', and meal bundles count as promotional.",
    });
    questions[`drinkCategory_${index}`] = choice(
      {
        question: `For candidate ${index}, when the priced item is a drink, which category fits best? Choose unclear only when the snippet does not name the drink type. Categories: ${drinkLabels}.`,
        inspect: `candidates[${index}].snippet`,
      },
      drinkCategoryCriteria,
    );
  }
  return questions;
}

type UkPriceJudgmentState = {
  pubName: string;
  pageUrl: string;
  snippet: string;
  priceText: string;
};

type UkPriceBatchJudgmentResult =
  | { ok: true; probabilities: UkPriceJudgmentProbabilities[] }
  | { ok: false; drop: UkPriceDropReason };

function dropForTypesafeBatchFailure(
  outcome: Exclude<SystemOneOutcome<Questions>, { status: "ok" }>,
): UkPriceDropReason {
  if (outcome.status === "skipped" && outcome.reason === "budget") {
    return "typesafe-judgment-budget-refused";
  }
  if (outcome.status === "failed" && outcome.reason === "timeout") {
    return "typesafe-judgment-call-timeout";
  }
  return "typesafe-judgment-call-error";
}

function applyJudgmentToCandidate(
  raw: UkPriceRawCandidate,
  probs: UkPriceJudgmentProbabilities,
  ctx: { pubName: string; pageUrl: string },
): {
  kept?: UkPriceCandidate;
  drops: UkPriceDropReason[];
  review?: UkPriceJudgmentReviewRow;
} {
  const decision = decisionFromJudgment(probs, raw.priceGbp);
  if (decision.outcome === "review") {
    return {
      drops: ["judgment-needs-review"],
      review: {
        pubName: ctx.pubName,
        pageUrl: ctx.pageUrl,
        snippet: raw.snippet,
        priceText: raw.priceText,
        priceGbp: raw.priceGbp,
        probabilities: probs,
      },
    };
  }
  if (decision.outcome === "reject") {
    return { drops: [decision.drop ?? "judgment-below-threshold"] };
  }
  if (decision.category) {
    const priceAtInSnippet = raw.at - Math.max(0, raw.at - UK_PRICE_JUDGMENT_SNIPPET_CHARS);
    const wineIdentity = decision.category === "wine"
      ? statedWineIdentity(raw.snippet, raw.verbatim, priceAtInSnippet)
      : null;
    const drinkLabel =
      wineIdentity?.drinkLabel ?? drinkLabelFromPriceContext(
        raw.snippet,
        raw.verbatim,
        priceAtInSnippet,
      ) ?? undefined;
    if (coffeeLineExcluded(decision.category, drinkLabel, raw.snippet, priceAtInSnippet)) {
      return { drops: ["no-category-word-nearby"] };
    }
    return {
      kept: {
        priceGbp: raw.priceGbp,
        category: decision.category,
        verbatim: raw.verbatim,
        context: raw.snippet,
        drinkLabel,
        ...(wineIdentity ? { servingSize: wineIdentity.servingSize } : {}),
      },
      drops: [],
    };
  }
  return { drops: ["judgment-below-threshold"] };
}

async function judgeUkPriceCandidateBatch(
  ctx: { pubName: string; pageUrl: string },
  batch: UkPriceRawCandidate[],
): Promise<UkPriceBatchJudgmentResult> {
  const state = {
    pubName: ctx.pubName,
    pageUrl: ctx.pageUrl,
    candidates: batch.map((row) => ({ snippet: row.snippet, priceText: row.priceText })),
  };
  const outcome = await systemOneOutcome(state, ukPriceQuestionsForBatch(batch.length), {
    lane: "typesafe",
  });
  if (outcome.status !== "ok") {
    return { ok: false, drop: dropForTypesafeBatchFailure(outcome) };
  }

  const probabilities: UkPriceJudgmentProbabilities[] = [];
  for (let index = 0; index < batch.length; index += 1) {
    const probs = probabilitiesFromBatchIndex(outcome.result.answers, index);
    if (!probs) {
      return { ok: false, drop: "typesafe-judgment-malformed-answer" };
    }
    probabilities.push(probs);
  }
  return { ok: true, probabilities };
}

export async function judgeUkPriceCandidate(
  state: UkPriceJudgmentState,
): Promise<UkPriceJudgmentProbabilities | null> {
  const judged = await judgeUkPriceCandidateBatch(
    { pubName: state.pubName, pageUrl: state.pageUrl },
    [
      {
        priceGbp: 0,
        verbatim: state.priceText,
        snippet: state.snippet,
        priceText: state.priceText,
        // The recorder judges a snippet on its own, so the figure's offset is
        // its offset within that snippet. Nothing on this path re-reads the
        // page, but the field is the candidate's identity and is never faked.
        at: Math.max(0, state.snippet.indexOf(state.priceText)),
      },
    ],
  );
  if (!judged.ok) return null;
  return judged.probabilities[0] ?? null;
}

export async function readVenueDrinkPricesJudged(
  html: string,
  ctx: { pubName: string; pageUrl: string },
  sourceFormat: UkPriceSourceFormat = "text",
): Promise<UkPriceJudgedReading> {
  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    return { ...readVenueDrinkPrices(html, sourceFormat), review: [] };
  }

  const text = pageText(html, true, sourceFormat);
  const candidates = findUkPriceCandidates(text, UK_PRICE_JUDGMENT_SNIPPET_CHARS);
  if (candidates.length === 0) {
    return { kept: [], drops: ["no-price-on-page"], review: [] };
  }

  const kept: UkPriceCandidate[] = [];
  const drops: UkPriceDropReason[] = [];
  const review: UkPriceJudgmentReviewRow[] = [];
  const batches = batchUkPriceCandidates(ctx, candidates);
  const keylessDecisions = readKeylessUkPriceDecisions(html, sourceFormat);

  for (const batch of batches) {
    const verbatimBatch = batch.filter((raw) => {
      if (!text.includes(raw.verbatim)) {
        drops.push("not-verbatim-on-page");
        return false;
      }
      return true;
    });
    if (verbatimBatch.length === 0) continue;

    const judged = await judgeUkPriceCandidateBatch(ctx, verbatimBatch);
    if (!judged.ok) {
      for (const raw of verbatimBatch) {
        const fallback = keylessDecisions.get(raw.at)!;
        if (fallback.kept) kept.push(fallback.kept);
        drops.push(judged.drop);
        if (fallback.drop) drops.push(fallback.drop);
      }
      continue;
    }

    for (const [index, raw] of verbatimBatch.entries()) {
      const probs = judged.probabilities[index];
      if (!probs) {
        drops.push("typesafe-judgment-malformed-answer");
        continue;
      }
      const outcome = applyJudgmentToCandidate(raw, probs, ctx);
      if (outcome.kept) kept.push(outcome.kept);
      drops.push(...outcome.drops);
      if (outcome.review) review.push(outcome.review);
    }
  }

  return { kept, drops, review };
}
