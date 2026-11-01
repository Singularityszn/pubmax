// The pub crawl cost calculator behind /pub-crawl-cost.
//
// A FREE TOOL IS A PAGE PEOPLE LINK TO, SO ITS SUMS MUST BE RIGHT EVERY TIME
// (docs/growth/BACKLINK_PLAYBOOK.md, tactic 38). The question it answers is the
// one a group asks before every crawl: what will this night cost each of us,
// and if we buy in rounds, who ends up paying more. It is pure and works in
// whole pence, so £5.85 times 7 is never £40.949999.
//
// It answers nothing about a real pub's price. The price is whatever the reader
// types; the page may offer a sourced figure as a starting point, and that
// figure carries its own source and day beside it.

export const CRAWL_LIMITS = {
  people: { min: 1, max: 40 },
  stops: { min: 1, max: 20 },
  drinksPerStop: { min: 1, max: 5 },
  pricePence: { min: 50, max: 5_000 },
} as const;

export type CrawlCostField = keyof typeof CRAWL_LIMITS;

export type CrawlCostInput = {
  people: number;
  stops: number;
  /** Drinks each person has at each stop. */
  drinksPerStop: number;
  /** The price of one drink, in pence. */
  pricePence: number;
};

export type CrawlCostResult = {
  ok: true;
  drinksEach: number;
  drinksTotal: number;
  totalPence: number;
  perPersonPence: number;
  perStopPence: number;
  /** One round: everyone in the group gets one drink. */
  roundPence: number;
  roundsTotal: number;
  /** Rounds bought, if the group takes turns in order. */
  rounds: {
    /** The fewest rounds anyone buys. */
    fewest: number;
    /** How many people buy one more round than `fewest`. */
    buyingOneMore: number;
    /** The gap between the most and the least anyone pays. Zero when even. */
    gapPence: number;
  };
};

export type CrawlCostError = { ok: false; field: CrawlCostField; message: string };

const FIELD_LABEL: Record<CrawlCostField, string> = {
  people: "People",
  stops: "Pubs",
  drinksPerStop: "Drinks each at each pub",
  pricePence: "Price of a drink",
};

function checkField(field: CrawlCostField, value: number): CrawlCostError | null {
  const { min, max } = CRAWL_LIMITS[field];
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    const shape = field === "pricePence" ? "an amount in pounds, for example 6.20" : "a whole number";
    return { ok: false, field, message: `${FIELD_LABEL[field]} must be ${shape}.` };
  }
  if (value < min || value > max) {
    const range = field === "pricePence"
      ? `between ${formatPence(min)} and ${formatPence(max)}`
      : `between ${min} and ${max}`;
    return { ok: false, field, message: `${FIELD_LABEL[field]} must be ${range}.` };
  }
  return null;
}

export function calculateCrawlCost(input: CrawlCostInput): CrawlCostResult | CrawlCostError {
  for (const field of ["people", "stops", "drinksPerStop", "pricePence"] as const) {
    const error = checkField(field, input[field]);
    if (error) return error;
  }
  const { people, stops, drinksPerStop, pricePence } = input;
  const drinksEach = stops * drinksPerStop;
  const drinksTotal = drinksEach * people;
  const totalPence = drinksTotal * pricePence;
  const roundPence = people * pricePence;
  const roundsTotal = drinksEach;
  const fewest = Math.floor(roundsTotal / people);
  const buyingOneMore = roundsTotal % people;
  return {
    ok: true,
    drinksEach,
    drinksTotal,
    totalPence,
    perPersonPence: drinksEach * pricePence,
    perStopPence: people * drinksPerStop * pricePence,
    roundPence,
    roundsTotal,
    rounds: {
      fewest,
      buyingOneMore,
      gapPence: buyingOneMore === 0 ? 0 : roundPence,
    },
  };
}

/**
 * Read a typed price such as "5.85", "£5.85" or "6" into whole pence. Returns
 * NaN for anything that is not a plain amount with at most two decimals, so the
 * calculator reports it rather than guessing.
 */
export function parsePriceToPence(raw: string): number {
  const trimmed = raw.trim().replace(/^£/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const [pounds, fraction = ""] = trimmed.split(".");
  return Number(pounds) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Read a typed whole number. Returns NaN for anything else. */
export function parseWholeNumber(raw: string): number {
  const trimmed = raw.trim();
  return /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
