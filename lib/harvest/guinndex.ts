// What one Guinndex pub page states that PubMaxx may take: a Guinness price,
// the day it was recorded and a link to the page. Nothing else.
//
// The registry row `guinndex-uk` (lib/harvest/sourceRegistry.ts) is the
// permission and names the exception. This module is the reading rule:
// a price is taken only when the page itself dates it. `updated_at` is when
// Guinndex last touched the record, not when anybody saw the price, so it
// never dates a price.

import { CATEGORY_PRICE_BANDS } from "@/lib/harvest/ukPriceCrawl";

export const GUINNDEX_SOURCE_ID = "guinndex-uk";
export const GUINNDEX_PUBLISHER = "Guinndex";
export const GUINNDEX_DRINK_LABEL = "Guinness";
export const GUINNDEX_SERVING = "Pint";

/** Why a priced Guinndex pub yields no row. */
export const GUINNDEX_SKIP_REASONS = [
  "no-price",
  "placeholder",
  "not-gbp",
  "implausible-price",
  "closed",
  "undated",
  "newer-record-disagrees",
  "flagged",
] as const;
type GuinndexSkipReason = (typeof GUINNDEX_SKIP_REASONS)[number];

type GuinndexObservation = {
  slug: string;
  priceGbp: number;
  /** ISO timestamp of the newest dated record that states this price. */
  observedAt: string;
  /** Guinndex's own word for how it got the price, kept for the run report. */
  priceSource: string | null;
};

type DatedPrice = { cents: number; at: string; flagged: boolean };

function isoOrNull(value: unknown, now: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms > now) return null;
  return new Date(ms).toISOString();
}

function isGuinness(row: Record<string, unknown>): boolean {
  return typeof row.drink_brand === "string" && /^guinness$/i.test(row.drink_brand.trim());
}

function datedPrices(detail: Record<string, unknown>, pub: Record<string, unknown>, now: number): DatedPrice[] {
  const dated: DatedPrice[] = [];
  for (const row of Array.isArray(detail.drink_prices) ? detail.drink_prices : []) {
    if (!row || typeof row !== "object" || !isGuinness(row)) continue;
    const at = isoOrNull(row.created_at, now);
    if (at && Number.isInteger(row.price_cents)) dated.push({ cents: row.price_cents, at, flagged: false });
  }
  for (const row of Array.isArray(detail.price_history) ? detail.price_history : []) {
    if (!row || typeof row !== "object") continue;
    const at = isoOrNull(row.created_at, now);
    if (!at || !Number.isInteger(row.new_price_cents)) continue;
    const flagged = typeof row.flag_reason === "string" && row.flag_reason.trim().length > 0;
    dated.push({ cents: row.new_price_cents, at, flagged });
  }
  if (pub.price_source === "ai_call" && Number.isInteger(pub.guinness_price_cents)) {
    const at = isoOrNull(pub.call_completed_at, now);
    if (at) dated.push({ cents: pub.guinness_price_cents as number, at, flagged: false });
  }
  return dated.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The observation one `/api/pub/{slug}` answer supports, or the reason it
 * supports none.
 *
 * THE PAGE MUST DATE ITS OWN PRICE. The headline price is taken only when a
 * dated record on the same page states the same figure, and only when the
 * newest dated record does not state a different one.
 * Placeholder prices are excluded because a dated seed entry is not a price
 * observation.
 */
export function readGuinndexObservation(
  detail: unknown,
  now: number = Date.now(),
): { ok: true; observation: GuinndexObservation } | { ok: false; reason: GuinndexSkipReason } {
  const body = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
  const pub = body.pub && typeof body.pub === "object" ? (body.pub as Record<string, unknown>) : null;
  const cents = pub?.guinness_price_cents;
  if (!pub || typeof pub.slug !== "string" || !Number.isInteger(cents) || (cents as number) <= 0) {
    return { ok: false, reason: "no-price" };
  }
  if (pub.price_source === "placeholder") return { ok: false, reason: "placeholder" };
  if (pub.currency !== undefined && pub.currency !== null && pub.currency !== "GBP") {
    return { ok: false, reason: "not-gbp" };
  }
  const priceGbp = (cents as number) / 100;
  const band = CATEGORY_PRICE_BANDS.beer ?? { minGbp: 2, maxGbp: 12 };
  if (priceGbp < band.minGbp || priceGbp > band.maxGbp) return { ok: false, reason: "implausible-price" };
  if (typeof pub.business_status === "string" && /^CLOSED/.test(pub.business_status)) {
    return { ok: false, reason: "closed" };
  }
  const dated = datedPrices(body, pub, now);
  const newest = dated[0];
  if (!newest) return { ok: false, reason: "undated" };
  if (newest.cents !== cents) return { ok: false, reason: "newer-record-disagrees" };
  // Guinndex flags a submission it doubts, and a doubted figure is not ours to state.
  if (dated.some((row) => row.cents === cents && row.flagged)) return { ok: false, reason: "flagged" };
  return {
    ok: true,
    observation: {
      slug: pub.slug,
      priceGbp,
      observedAt: newest.at,
      priceSource: typeof pub.price_source === "string" ? pub.price_source : null,
    },
  };
}
