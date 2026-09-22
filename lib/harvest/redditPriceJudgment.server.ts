import "server-only";

import { noul, type Questions } from "@typesafe-ai/sdk";

import { systemOneOutcome } from "@/lib/ai/typesafe.server";
import {
  probabilitiesFromBatchIndex,
  type UkPriceJudgmentProbabilities,
} from "@/lib/harvest/ukPriceJudgmentPolicy";
import {
  keylessRedditJudgment,
  type RedditPriceJudgmentProbabilities,
} from "@/lib/harvest/redditPriceJudgmentPolicy";
import { ukPriceQuestionsForBatch } from "@/lib/harvest/ukPriceJudgment.server";

export type RedditPriceJudgmentInput = {
  snippet: string;
  priceText: string;
  permalink: string;
  pubNameHint?: string;
};

function redditQuestionsForBatch(candidateCount: number): Questions {
  const base = ukPriceQuestionsForBatch(candidateCount);
  for (let index = 0; index < candidateCount; index += 1) {
    base[`isActualPriceReport_${index}`] = noul({
      question: `For candidate ${index}, did the poster report a price they personally paid or saw on a menu today, not a guess, joke, hypothetical, or nostalgia?`,
      inspect: `candidates[${index}].snippet`,
      focus: "Wishful pricing, 'remember when', and rhetorical questions are not actual reports.",
    });
  }
  return base;
}

function actualPriceReportScore(
  answers: Record<string, unknown>,
  index: number,
): number | null {
  const row = answers[`isActualPriceReport_${index}`];
  if (!row || typeof row !== "object" || !("noul" in row)) return null;
  const actual = (row as { noul?: unknown }).noul;
  return typeof actual === "number" ? actual : null;
}

function redditProbabilitiesFromAnswers(
  answers: Record<string, unknown>,
  drink: UkPriceJudgmentProbabilities | null,
  index: number,
): RedditPriceJudgmentProbabilities | null {
  if (!drink) return null;
  const actual = actualPriceReportScore(answers, index);
  if (actual === null) return null;
  return { isActualPriceReport: actual, drinkJudgment: drink };
}

export async function judgeRedditPriceCandidate(
  input: RedditPriceJudgmentInput,
): Promise<RedditPriceJudgmentProbabilities | null> {
  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    return keylessRedditJudgment(input.snippet);
  }

  const state = {
    permalink: input.permalink,
    pubNameHint: input.pubNameHint ?? "",
    candidates: [{ snippet: input.snippet, priceText: input.priceText }],
  };
  const outcome = await systemOneOutcome(state, redditQuestionsForBatch(1), { lane: "typesafe" });
  if (outcome.status !== "ok") return null;

  const drink = probabilitiesFromBatchIndex(outcome.result.answers, 0);
  return redditProbabilitiesFromAnswers(outcome.result.answers, drink, 0);
}
