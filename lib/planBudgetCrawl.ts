// THE £20 CRAWL (launch plan section 3): a crawl whose listed pints fit a total.
//
// There is ONE budget path and this module only feeds it. The generator already
// reads a per-person route budget out of the words ("£20.00 per person", and
// now "a £20 crawl", lib/planPriceLimits.ts), carries it as
// `budgetLimitPence`, and the optimizer (lib/planRouteOptimizer.ts) only
// builds a route whose listed, attributable, non-stale pints add up to it at
// one pint a stop. So the chip adds words, never a second field, and the
// ledger below only reads what the generator returned.
//
// THREE RULES.
// 1. ONE PINT A STOP, PER PERSON. The total is the sum of each stop's listed
//    pint. Nothing here suggests a second round, and no total rewards drinking
//    more: a stop is a pub, never a count of pints.
// 2. EVERY FIGURE CARRIES ITS DAY. A ledger row prints the day its price was
//    read. A stop whose figure is not a listed price (an estimate, a swapped
//    pub with no figure) leaves the total out rather than summing a guess.
// 3. A TOTAL THAT DOES NOT FIT SAYS SO. Over the budget is a sentence with the
//    figure, never a colour.
//
// Pure and browser-safe.

import { formatGbp } from "@/lib/formatGbp";
import { planPriceLimits } from "@/lib/planPriceLimits";
import { formatTrustDay } from "@/lib/trustPill";

/** The chip's budget: £20 a person, for one pint at each stop. */
export const PLAN_BUDGET_CRAWL_PENCE = 2_000;

/** The chip's words. */
export const PLAN_BUDGET_CRAWL_LABEL = "£20 crawl";

/** What the chip says it does, under the chip. */
export const PLAN_BUDGET_CRAWL_NOTE = "Stops whose listed pints add up to £20 or less, one pint a stop.";

/**
 * The words the chip adds to an ask, or the ask itself when it already names a
 * route budget: a budget the reader typed is theirs, and it wins.
 */
export function planBudgetCrawlQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  if (planPriceLimits(trimmed).routeBudgetPence !== null) return trimmed;
  return `${trimmed.replace(/[.,;\s]+$/, "")}, a £${PLAN_BUDGET_CRAWL_PENCE / 100} crawl`;
}

/** One stop as the ledger reads it. */
export type PlanBudgetLedgerStop = {
  venueName: string;
  pricePence: number | null | undefined;
  priceKind?: "listed" | "estimated";
  /** ISO day or instant the listed price was read. */
  priceObservedAt?: string | null;
};

type PlanBudgetLedgerRow = {
  position: number;
  venueName: string;
  /** "£4.80", or null when this stop has no listed figure. */
  price: string | null;
  /** "listed 2 Oct", "read date not recorded", or null with no figure. */
  readLine: string | null;
  /** The running total after this stop, or null once a stop has no figure. */
  runningTotal: string | null;
};

export type PlanBudgetLedger = {
  rows: PlanBudgetLedgerRow[];
  limit: string;
  /** Total of every stop's listed pint, or null when any stop has none. */
  totalPence: number | null;
  /** True or false against the limit, null with no total. */
  fits: boolean | null;
  /** The one summary line under the rows. */
  summary: string;
};

function listedPence(stop: PlanBudgetLedgerStop): number | null {
  const pence = stop.pricePence;
  if (stop.priceKind === "estimated") return null;
  return typeof pence === "number" && Number.isSafeInteger(pence) && pence > 0 ? pence : null;
}

function readLine(observedAt: string | null | undefined): string {
  const at = typeof observedAt === "string" ? Date.parse(observedAt) : Number.NaN;
  return Number.isFinite(at) ? `listed ${formatTrustDay(at)}` : "read date not recorded";
}

/** The running ledger for a route under a per-person budget. */
export function planBudgetLedger(
  stops: readonly PlanBudgetLedgerStop[],
  limitPence: number,
): PlanBudgetLedger {
  let running: number | null = 0;
  const rows = stops.map((stop, index): PlanBudgetLedgerRow => {
    const pence = listedPence(stop);
    running = running === null || pence === null ? null : running + pence;
    return {
      position: index + 1,
      venueName: stop.venueName,
      price: pence === null ? null : formatGbp(pence / 100),
      readLine: pence === null ? null : readLine(stop.priceObservedAt),
      runningTotal: running === null ? null : formatGbp(running / 100),
    };
  });
  const totalPence: number | null = running;
  const limit = formatGbp(limitPence / 100);
  const fits = totalPence === null ? null : totalPence <= limitPence;
  const summary = totalPence === null
    ? `No total yet: a stop has no listed pint price, so we cannot say it fits ${limit}.`
    : fits
      ? `${formatGbp(totalPence / 100)} for one pint at each stop, inside your ${limit}.`
      : `${formatGbp(totalPence / 100)} for one pint at each stop, over your ${limit}.`;
  return { rows, limit, totalPence, fits, summary };
}

/** One stop of the cheapest route the generator could find, for a refusal. */
export type PlanBudgetMissStop = { venueName: string; pricePence: number };

/**
 * The refusal when no route fits the budget, naming the cheapest one the
 * generator could find and its total, so the reader can raise the budget or
 * change the area knowing what it would take.
 */
export function planBudgetMissLine(input: {
  stopCount: number;
  areaName: string;
  limitPence: number;
  cheapest: readonly PlanBudgetMissStop[] | null;
}): string {
  const limit = formatGbp(input.limitPence / 100);
  const head = `No ${input.stopCount}-stop route in ${input.areaName} fits ${limit} for one listed pint at each stop.`;
  if (!input.cheapest || input.cheapest.length === 0) {
    return `${head} We could not find a fully priced route to compare.`;
  }
  const total = input.cheapest.reduce((sum, stop) => sum + stop.pricePence, 0);
  const names = input.cheapest.map((stop) => stop.venueName);
  const named = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `${head} The cheapest we found is ${formatGbp(total / 100)}: ${named}.`;
}
