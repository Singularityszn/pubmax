// Price adapter over the generic fact-claim model (Wayfinder 3.3). Wires the
// two price signals a venue surface holds — the on-record dataset/scraped
// baseline and the freshest community-reported "now" price — through
// lib/factClaims so a served price carries an honest verification level and any
// live conflict surfaces plainly.
//
// A THIRD SIGNAL USED TO RIDE HERE and battle test L03 retired it: the
// anonymous price-confirm vouch, which entered as its own `community`
// publisher and upgraded a lone scraped baseline to `corroborated` on the word
// of a hashed IP. Corroboration is a claim about two PEOPLE, and an IP is a
// household, a pub's own wifi and a mobile carrier's NAT. Pure and hermetic:
// callers pass `now`.

import {
  buildFactClaims,
  resolveClaims,
  type FactAuthority,
  type FactClaim,
  type FactResolution,
  type FactSource,
} from "@/lib/factClaims";
import { FRESH_WITHIN_DAYS } from "@/lib/priceConfidence";
import { DAY_MS } from "@/lib/dayMs";

// A price disagreement counts as "live" for the same fortnight priceConfidence
// treats a community vouch as fresh (FRESH_WITHIN_DAYS = 14). Beyond it, an old
// losing price is history — the then-vs-now story — not a live conflict.
export const PRICE_CONFLICT_WINDOW_MS = FRESH_WITHIN_DAYS * DAY_MS;

/** Compare GBP prices in integer pennies so 6.4 and 6.40 are one value. */
export function pricesEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export type PriceSignalInput = {
  gbp: number;
  authority: FactAuthority;
  /** Epoch ms observed; 0 for an undated, standing on-record baseline. */
  observedAt: number;
  publisher?: string;
  confidence?: number;
  reviewed?: boolean;
};

export function buildPriceClaims(
  fieldId: string,
  signals: readonly PriceSignalInput[],
): FactClaim<number>[] {
  const sources: FactSource<number>[] = signals.map((s) => ({
    authority: s.authority,
    value: s.gbp,
    observedAt: s.observedAt,
    publisher: s.publisher,
    confidence: s.confidence,
    reviewed: s.reviewed,
  }));
  return buildFactClaims(fieldId, sources, pricesEqual);
}

export type ResolvePriceOptions = {
  now: number;
  windowMs?: number;
};

/**
 * Resolve a venue-beverage price from its signals. Serves by
 * authority > freshness > corroboration > confidence and exposes any live
 * conflict. Returns null when there are no signals.
 */
export function resolvePrice(
  fieldId: string,
  signals: readonly PriceSignalInput[],
  opts: ResolvePriceOptions,
): FactResolution<number> | null {
  return resolveClaims(buildPriceClaims(fieldId, signals), {
    now: opts.now,
    conflictWindowMs: opts.windowMs ?? PRICE_CONFLICT_WINDOW_MS,
    isEqual: pricesEqual,
  });
}

/** Stable field id for a venue-beverage price fact. */
export function priceFieldId(venueId: string, beverage = "pint"): string {
  return `price:${venueId}:${beverage}`;
}

export type PriceStorySignalsInput = {
  /** The dataset/scraped baseline on record, GBP. */
  baselineGbp: number | null;
  /** The freshest community-reported price, GBP. */
  nowGbp: number | null;
  /** Epoch ms the community "now" price was observed, when known. */
  nowObservedAt?: number | null;
};

/**
 * Build price signals for the venue Golden Thread from the values the surface
 * already has: the on-record baseline (scraped, undated) and the community
 * "now" price. When the two disagree, resolvePrice reports a live conflict for
 * the surface to expose.
 *
 * THE ANONYMOUS VOUCH IS GONE (battle test L03). It used to ride here as a
 * third `community` publisher at the confirmed figure, which upgraded a lone
 * scraped baseline to `corroborated` on the word of a hashed IP. An IP is a
 * household, a pub's own wifi and a mobile carrier's NAT, so it could never
 * prove two people, and "corroborated" is a word this tree owns elsewhere with
 * a much harder meaning: two authority keys derived from two verified
 * accounts. One word, one meaning, and this was the copy of it that could not
 * keep the promise.
 */
export function priceStorySignals(input: PriceStorySignalsInput): PriceSignalInput[] {
  const signals: PriceSignalInput[] = [];

  if (typeof input.baselineGbp === "number" && Number.isFinite(input.baselineGbp)) {
    signals.push({
      gbp: input.baselineGbp,
      authority: "scraped",
      observedAt: 0, // on record, undated — never "recent", but serves by authority
      publisher: "dataset",
      confidence: 0.6,
    });
  }

  if (typeof input.nowGbp === "number" && Number.isFinite(input.nowGbp)) {
    signals.push({
      gbp: input.nowGbp,
      authority: "community",
      observedAt: typeof input.nowObservedAt === "number" ? input.nowObservedAt : 0,
      publisher: "community-report",
      confidence: 0.5,
    });
  }

  return signals;
}

/**
 * Distinct GBP values in a live price conflict, ascending, or [] when the field
 * resolves cleanly. The surface renders these plainly ("Reported at £6.40 and
 * £6.90 recently") instead of silently serving one.
 */
export function conflictPrices(resolution: FactResolution<number> | null): number[] {
  if (!resolution || !resolution.conflict) return [];
  return [...resolution.conflict.values].sort((a, b) => a - b);
}
