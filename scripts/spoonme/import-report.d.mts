// Types for the plain-ESM importer, the lib/buildInfo.mjs idiom: `allowJs` is
// false, and __tests__/spoonsValueImport.test.ts holds the basket and rank
// rules the importer applies, so it has to be able to import them.

export const SPOONME_REPORT_URL: string;
export const SPOONME_AUTHOR: string;
export const SPOONME_PUBLISHED_AT: string;
export const SPOONME_TITLE: string;

export type SpoonmeRawLine = {
  name: string;
  servingLabel: string;
  quantity: number;
  glasses: number;
  linePricePence: number;
  lineMilliunits: number;
  bundleLabel?: string;
};

export type SpoonmeRawRow = {
  id: string;
  name: string;
  milliunits: number;
  pence: number;
  drinkCount: number;
  lines: SpoonmeRawLine[];
  rankNumber: number;
};

export type SpoonmeReport = {
  builtAt: string;
  budgetPence: number;
  rows: SpoonmeRawRow[];
  unranked?: unknown[];
};

/** Recover the ranking object a prerendered report inlines in its own payload. */
export function extractReportData(html: string): SpoonmeReport;

/**
 * Re-derive one row's totals from its own lines. Returns the reason it was
 * refused, or null when its own arithmetic holds. A refusal is never repaired.
 */
export function checkRowArithmetic(
  // Deliberately loose: this is the function that judges a row NOBODY has
  // validated, so a test must be able to hand it a malformed one.
  row: unknown,
  budgetPence: number,
): string | null;

/** The rank order the units produce: best first, ties sharing a rank. */
export function rankByUnits(
  rows: readonly { id: string; milliunits: number; pence: number }[],
): Map<string, number>;
