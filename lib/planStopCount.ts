import { lastOf } from "@/lib/tuple";

/**
 * How many pub stops a Plan may hold. This ONE table is the whole vocabulary:
 * the picker offers it, the generator targets it, the grounding proof mints
 * against it and route replacement validates against it. Widen it here or
 * nowhere, because a floor typed a second time is how one-pub meetups became
 * unreachable while every gate below still agreed with itself.
 *
 * One and two are ordinary answers, not a fallback: an outing is often one
 * venue you meet at, or two. Three stays the DEFAULT, so a night nobody sized
 * still builds the crawl it always built.
 */
export const PLAN_STOP_COUNTS = [1, 2, 3, 4, 5, 6] as const;
export type PlanStopCount = (typeof PLAN_STOP_COUNTS)[number];
export const MIN_PLAN_STOP_COUNT = PLAN_STOP_COUNTS[0];
export const MAX_PLAN_STOP_COUNT = lastOf(PLAN_STOP_COUNTS);
/** Explicitly 3, never the first row of the table: widening the floor may not move the default. */
export const DEFAULT_PLAN_STOP_COUNT: PlanStopCount = 3;

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six"] as const;

/** The stop-count range in words, derived so a refusal sentence cannot rot apart from the table. */
export const PLAN_STOP_COUNT_RANGE_SENTENCE =
  `${NUMBER_WORDS[MIN_PLAN_STOP_COUNT]} to ${NUMBER_WORDS[MAX_PLAN_STOP_COUNT]}`;

export function isPlanStopCount(value: unknown): value is PlanStopCount {
  return typeof value === "number"
    && Number.isInteger(value)
    && (PLAN_STOP_COUNTS as readonly number[]).includes(value);
}

export function normalizePlanStopCount(value: unknown): PlanStopCount {
  return isPlanStopCount(value) ? value : DEFAULT_PLAN_STOP_COUNT;
}

/**
 * What a Plan of this size IS. One pub is a meetup: nobody crawls anywhere, so
 * printing "crawl" over it is a small lie on the reader's own screen. Two pubs
 * and up is a crawl, because there is a walk between them.
 */
export function planOutingNoun(stopCount: unknown): "meetup" | "crawl" {
  return normalizePlanStopCount(stopCount) === 1 ? "meetup" : "crawl";
}

/** "1 stop" / "2 stops": a one-pub night may not be printed with a plural. */
export function planStopCountPhrase(stopCount: unknown): string {
  const count = normalizePlanStopCount(stopCount);
  return `${count} stop${count === 1 ? "" : "s"}`;
}

export function inferPlanStopCount(query: string, numberWords: Readonly<Record<string, number>>): PlanStopCount {
  const explicitNumeric = query.match(/\b([1-6])\s*(?:pubs?|stops?|venues?)\b/i);
  if (explicitNumeric) return Number(explicitNumeric[1]) as PlanStopCount;
  for (const [word, value] of Object.entries(numberWords)) {
    if (value < MIN_PLAN_STOP_COUNT || value > MAX_PLAN_STOP_COUNT) continue;
    if (new RegExp(`\\b${word}\\s+(?:pubs?|stops?|venues?)\\b`, "i").test(query)) {
      return value as PlanStopCount;
    }
  }
  return /\bbig\s+crawl\b/i.test(query) ? MAX_PLAN_STOP_COUNT : DEFAULT_PLAN_STOP_COUNT;
}
