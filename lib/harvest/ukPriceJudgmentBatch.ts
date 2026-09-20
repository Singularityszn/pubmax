import type { UkPriceRawCandidate } from "@/lib/harvest/ukPriceCrawl";

/** State plus the longest single question must stay under the Jev 32k-token ceiling; headroom is intentional. */
export const UK_PRICE_JUDGMENT_TOKEN_BUDGET = 28_000;

/** Conservative sizing when the SDK does not expose a counter (Jev docs use ~4 chars per token). */
export const UK_PRICE_JUDGMENT_CHARS_PER_TOKEN = 4;

/**
 * One candidate's three questions (including criteria) sized as the longest question
 * in the batch; Jev limits state plus the longest question, not state plus all questions.
 */
export const UK_PRICE_JUDGMENT_LONGEST_QUESTION_TOKENS = 2_200;

export type UkPriceJudgmentBatchContext = {
  pubName: string;
  pageUrl: string;
};

export function estimateUkPriceJudgmentBatchTokens(
  ctx: UkPriceJudgmentBatchContext,
  candidates: ReadonlyArray<Pick<UkPriceRawCandidate, "snippet" | "priceText">>,
): number {
  const stateChars =
    96 +
    ctx.pubName.length +
    ctx.pageUrl.length +
    candidates.reduce((sum, row) => sum + row.snippet.length + row.priceText.length + 48, 0);
  const stateTokens = Math.ceil(stateChars / UK_PRICE_JUDGMENT_CHARS_PER_TOKEN);
  return stateTokens + UK_PRICE_JUDGMENT_LONGEST_QUESTION_TOKENS;
}

/** Largest prefix of `candidates` that fits the token budget (always at least one when non-empty). */
export function ukPriceJudgmentBatchSize(
  ctx: UkPriceJudgmentBatchContext,
  candidates: ReadonlyArray<Pick<UkPriceRawCandidate, "snippet" | "priceText">>,
  tokenBudget = UK_PRICE_JUDGMENT_TOKEN_BUDGET,
): number {
  if (candidates.length === 0) return 0;
  let size = 1;
  while (
    size < candidates.length &&
    estimateUkPriceJudgmentBatchTokens(ctx, candidates.slice(0, size + 1)) <= tokenBudget
  ) {
    size += 1;
  }
  if (estimateUkPriceJudgmentBatchTokens(ctx, candidates.slice(0, size)) > tokenBudget) {
    return 1;
  }
  return size;
}

/** Split page candidates into batches sized for one System One call each. */
export function batchUkPriceCandidates<T extends Pick<UkPriceRawCandidate, "snippet" | "priceText">>(
  ctx: UkPriceJudgmentBatchContext,
  candidates: readonly T[],
  tokenBudget = UK_PRICE_JUDGMENT_TOKEN_BUDGET,
): T[][] {
  const batches: T[][] = [];
  let index = 0;
  while (index < candidates.length) {
    const rest = candidates.slice(index);
    const take = ukPriceJudgmentBatchSize(ctx, rest, tokenBudget);
    batches.push(rest.slice(0, take));
    index += take;
  }
  return batches;
}
