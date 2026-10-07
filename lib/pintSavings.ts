// What choosing the cheap pub is worth, in pounds, and the one rule that says
// so.
//
// Captain 7 Sep 2026: "How do we ensure that as soon as a user visits the
// website, they immediately are locked in... If I'm able to help all the people
// who download the app, at least £20 a month..." A number that big has to be
// earned, so this module holds the arithmetic and refuses everything it cannot
// back.
//
// THREE RULES.
//
// (1) THE FIGURE IS MEASURED, NEVER TYPED. The city average is the mean
//     cheapest pint over every priced pub the dataset holds. The cheap average
//     is the mean over the cheapest third of them, the same third
//     lib/priceBand.ts calls `cheap`. The gap between the two is what one pint
//     is worth, and __tests__/pintSavings.test.ts measures both from the
//     shipped dataset, so a re-collected dataset moves the sentence rather than
//     leaving it stale.
//
// (2) A STRANGER IS TOLD THE PER PINT GAP AND NOTHING ELSE. We do not know how
//     many pints they drink, so multiplying by a made-up month is an invented
//     number and the landing prints none.
//
// (3) A SIGNED IN READER IS TOLD THEIR OWN TOTAL. One logged price counts when
//     it is under the city average, and it counts for the gap it actually beat
//     it by. A price at or over the average adds nothing, so the counter can
//     never run ahead of what the reader really did.
//
// Pure: no fs, no React, no dataset import. The server hands it figures.

import { formatGbp } from "@/lib/formatGbp";

/** The city's own two figures, both derived from the priced dataset. */
export type PintPriceAverages = {
  /** Mean cheapest pint over every priced pub. */
  averageGbp: number;
  /** Mean cheapest pint over the cheapest third of them. */
  cheapAverageGbp: number;
  /** How many priced pubs the two means were taken over. */
  sampleSize: number;
};

/**
 * Fewer priced pubs than this and a mean is one pub's opinion, so the landing
 * prints no figure at all.
 */
export const MIN_SAVINGS_SAMPLE = 30;

/** The two means, over one array of prices. Sorted here, so callers need not. */
export function pintPriceAverages(prices: readonly number[]): PintPriceAverages | null {
  const usable = prices.filter((price) => Number.isFinite(price) && price > 0).sort((a, b) => a - b);
  if (usable.length < MIN_SAVINGS_SAMPLE) return null;
  const mean = (rows: readonly number[]): number =>
    rows.reduce((total, price) => total + price, 0) / rows.length;
  // The cheapest third, the same cut lib/priceBand.ts makes.
  const third = usable.slice(0, Math.floor(usable.length / 3));
  return {
    averageGbp: round2(mean(usable)),
    cheapAverageGbp: round2(mean(third)),
    sampleSize: usable.length,
  };
}

/** What one pint is worth: the gap between the city average and the cheap third. */
export function savingPerPintGbp(averages: PintPriceAverages): number {
  return round2(Math.max(0, averages.averageGbp - averages.cheapAverageGbp));
}

/**
 * The line a stranger reads. It states the two prices it compared, so the
 * figure can be checked rather than believed. Null when the gap rounds to
 * nothing, because "you save £0.00" is not a reason to download anything.
 */
export function strangerSavingLine(averages: PintPriceAverages | null): string | null {
  if (!averages) return null;
  const gap = savingPerPintGbp(averages);
  if (gap < 0.05) return null;
  return `The average listed pint across ${averages.sampleSize.toLocaleString("en-GB")} London pubs is ${formatGbp(averages.averageGbp)}. In the cheapest third it's ${formatGbp(averages.cheapAverageGbp)}. That's ${formatGbp(gap)} a pint you keep.`;
}

/** One price a reader logged, with the pub it was logged at. */
export type LoggedPrice = { priceGbp: number };

export type ReaderSavings = {
  /** How many logged prices came in under the city average. */
  pints: number;
  /** The pounds those prices beat the average by, added up. */
  savedGbp: number;
};

/**
 * What the reader themselves saved: for every price they logged under the city
 * average, the gap it beat the average by. A price at or over the average
 * counts for nothing.
 */
export function readerSavings(
  logged: readonly LoggedPrice[],
  averages: PintPriceAverages | null,
): ReaderSavings {
  if (!averages) return { pints: 0, savedGbp: 0 };
  let pints = 0;
  let savedGbp = 0;
  for (const row of logged) {
    if (!Number.isFinite(row.priceGbp) || row.priceGbp <= 0) continue;
    const gap = averages.averageGbp - row.priceGbp;
    if (gap <= 0) continue;
    pints += 1;
    savedGbp += gap;
  }
  return { pints, savedGbp: round2(savedGbp) };
}

/**
 * The line a signed in reader reads. Null until they have logged a price that
 * beat the average, because a counter at zero is a scolding, not a reward.
 */
export function readerSavingLine(savings: ReaderSavings): string | null {
  if (savings.pints < 1 || savings.savedGbp < 0.05) return null;
  const pints = savings.pints === 1 ? "1 pint" : `${savings.pints} pints`;
  return `You've kept ${formatGbp(savings.savedGbp)} over ${pints} you logged under the London average.`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
