// Structured Visit Report SUMMARY (Wayfinder 3.4) — the PURE aggregation core.
//
// Turns a pile of Visit Reports into a few HONEST lines a venue sheet can render
// next to (never instead of) the existing star ratings. Two hard rules from the
// brief and the taste doctrine:
//   • NO public star score, and no average dressed up as a score. This produces
//     plain english ("Usually steady, most would return"), not a number.
//   • Real data or honest nothing: a line renders only when enough reports carry
//     that field, and the summary as a whole stays hidden under a floor. Nothing
//     is invented, no counts are faked, and there are no em dashes in the copy.
//
// Recency + confidence weighted: a report's influence decays with a ~30-day
// half-life, so the summary reflects what the pub is like NOW, not a year ago.
// A fresh report outweighs a stale opposite one. Confidence is the raw volume of
// recent reports — under the floor there simply isn't a summary.
//
// PURE: no Date.now() (the clock is injected), no storage, no React — so it unit
// tests against a fixed clock and the same function powers the server route.

import { londonEveningKey, type Atmosphere, type Busyness } from "@/lib/visitReports";
import type { VisitReportDTO } from "@/lib/visitReports";

/** The recency half-life: a report ~30 days old counts half as much as a fresh
 *  one, ~60 days a quarter, and so on. Never hits zero (old signal fades, it is
 *  not erased), but fresh reports dominate. */
export const VISIT_REPORT_HALF_LIFE_DAYS = 30;

/** The whole summary stays hidden under this many reports — a night or two is an
 *  anecdote, not a pattern, and showing it would be the fake-confidence the
 *  ratings vote-floor exists to prevent. */
export const MIN_REPORTS_TO_SUMMARISE = 3;

/** A single LINE needs at least this many reports carrying that field before it
 *  renders — so "most would return" never stands on one tap. */
export const MIN_FIELD_REPORTS = 2;

/** Days between two London evening day keys (b - a), calendar-exact. Parses the
 *  date-only keys at UTC midnight so DST never adds or drops an hour. */
function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return NaN;
  return Math.round((tb - ta) / 86_400_000);
}

/** The recency weight for a report of the given age. Age is clamped at 0 (a
 *  future-dated row, already rejected at write, would otherwise weigh > 1). */
export function recencyWeight(ageDays: number, halfLifeDays: number = VISIT_REPORT_HALF_LIFE_DAYS): number {
  const age = Number.isFinite(ageDays) ? Math.max(0, ageDays) : 0;
  return Math.pow(0.5, age / halfLifeDays);
}

export type BusynessSummary = { top: Busyness | null; share: number; n: number };
export type AtmosphereSummary = { top: Atmosphere | null; share: number; n: number };
export type WouldReturnSummary = { yesShare: number; n: number };
export type PriceSanitySummary = { steepShare: number; n: number };

export type VisitReportSummary = {
  /** Raw count of reports considered (the honest headline number). */
  total: number;
  /** Sum of recency weights (the "confidence" mass). */
  weight: number;
  /** Whether the summary should render at all (total >= floor). */
  shown: boolean;
  /** Ready-to-render headline, or null when under the floor. */
  headline: string | null;
  /** Honest one-liners, in a stable order. Empty when nothing clears its floor. */
  lines: string[];
  busyness: BusynessSummary;
  atmosphere: AtmosphereSummary;
  wouldReturn: WouldReturnSummary;
  priceSanity: PriceSanitySummary;
};

type WeightedField<T extends string> = {
  /** value -> summed recency weight */
  weights: Map<T, number>;
  /** summed recency weight across reports carrying this field */
  total: number;
  /** raw count of reports carrying this field */
  n: number;
};

function emptyField<T extends string>(): WeightedField<T> {
  return { weights: new Map<T, number>(), total: 0, n: 0 };
}

function addWeight<T extends string>(field: WeightedField<T>, value: T | null, weight: number): void {
  if (value === null) return;
  field.weights.set(value, (field.weights.get(value) ?? 0) + weight);
  field.total += weight;
  field.n += 1;
}

/** Argmax over a weighted field in a FIXED value order (deterministic ties). */
function topOf<T extends string>(field: WeightedField<T>, order: readonly T[]): { top: T | null; share: number } {
  let top: T | null = null;
  let best = 0;
  for (const value of order) {
    const w = field.weights.get(value) ?? 0;
    if (w > best) {
      best = w;
      top = value;
    }
  }
  const share = field.total > 0 ? best / field.total : 0;
  return { top, share };
}

const BUSYNESS_ORDER: readonly Busyness[] = ["quiet", "steady", "rammed"];
const ATMOSPHERE_ORDER: readonly Atmosphere[] = [
  "cosy",
  "lively",
  "chilled",
  "rowdy",
  "traditional",
  "sporty",
];

function busynessLine(top: Busyness | null, share: number, n: number): string | null {
  if (top === null || n < MIN_FIELD_REPORTS) return null;
  const word = top === "quiet" ? "quiet" : top === "rammed" ? "rammed" : "steady";
  // A clear majority reads "Usually"; a plurality reads "Often" (honest hedge).
  return `${share >= 0.5 ? "Usually" : "Often"} ${word}`;
}

function atmosphereLine(top: Atmosphere | null, n: number): string | null {
  if (top === null || n < MIN_FIELD_REPORTS) return null;
  return `Usually feels ${top}`;
}

function wouldReturnLine(yesShare: number, n: number): string | null {
  if (n < MIN_FIELD_REPORTS) return null;
  if (yesShare >= 0.66) return "Most would return";
  if (yesShare >= 0.4) return "Mixed on returning";
  return "Few would return";
}

function priceSanityLine(steepShare: number, n: number): string | null {
  if (n < MIN_FIELD_REPORTS) return null;
  const fineShare = 1 - steepShare;
  if (fineShare >= 0.66) return "Prices felt fair";
  if (steepShare >= 0.66) return "Prices felt steep";
  return "Split on price";
}

/**
 * Fold a venue's Visit Reports into the honest, recency-weighted summary. `now`
 * is injected (no Date.now() here). Reports with an unparseable `visitedAt` are
 * skipped (they can't prove their recency). Empty / under-floor input yields a
 * blank-but-valid summary (shown: false), never fabricated confidence.
 */
export function summariseVisitReports(
  reports: readonly Pick<VisitReportDTO, "visitedAt" | "busyness" | "atmosphere" | "wouldReturn" | "priceSanity">[],
  now: Date | number = new Date(),
  halfLifeDays: number = VISIT_REPORT_HALF_LIFE_DAYS,
): VisitReportSummary {
  const today = londonEveningKey(typeof now === "number" ? now : now.getTime());

  const busyness = emptyField<Busyness>();
  const atmosphere = emptyField<Atmosphere>();
  let returnYesWeight = 0;
  let returnTotalWeight = 0;
  let returnN = 0;
  let steepWeight = 0;
  let priceTotalWeight = 0;
  let priceN = 0;
  let total = 0;
  let weightSum = 0;

  for (const r of reports) {
    const age = daysBetween(r.visitedAt, today);
    if (!Number.isFinite(age)) continue; // unparseable date — can't weight it
    const weight = recencyWeight(age, halfLifeDays);
    total += 1;
    weightSum += weight;

    addWeight(busyness, r.busyness, weight);
    addWeight(atmosphere, r.atmosphere, weight);

    if (r.wouldReturn !== null) {
      returnTotalWeight += weight;
      returnN += 1;
      if (r.wouldReturn === "yes") returnYesWeight += weight;
    }
    if (r.priceSanity !== null) {
      priceTotalWeight += weight;
      priceN += 1;
      if (r.priceSanity === "steep") steepWeight += weight;
    }
  }

  const busy = topOf(busyness, BUSYNESS_ORDER);
  const atmos = topOf(atmosphere, ATMOSPHERE_ORDER);
  const yesShare = returnTotalWeight > 0 ? returnYesWeight / returnTotalWeight : 0;
  const steepShare = priceTotalWeight > 0 ? steepWeight / priceTotalWeight : 0;

  const shown = total >= MIN_REPORTS_TO_SUMMARISE;

  const lines = shown
    ? [
        busynessLine(busy.top, busy.share, busyness.n),
        atmosphereLine(atmos.top, atmosphere.n),
        wouldReturnLine(yesShare, returnN),
        priceSanityLine(steepShare, priceN),
      ].filter((line): line is string => line !== null)
    : [];

  const headline = shown ? `${total} recent visit ${total === 1 ? "report" : "reports"}` : null;

  return {
    total,
    weight: weightSum,
    shown,
    headline,
    lines,
    busyness: { top: busy.top, share: busy.share, n: busyness.n },
    atmosphere: { top: atmos.top, share: atmos.share, n: atmosphere.n },
    wouldReturn: { yesShare, n: returnN },
    priceSanity: { steepShare, n: priceN },
  };
}
