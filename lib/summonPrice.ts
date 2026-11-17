import type { DrinkMeasure } from "@/lib/drinkMeasure";
import type { Venue } from "@/lib/venues";

export type SummonPriceEvidence = {
  venueId: string;
  rowId: string;
  drink: string;
  measure: DrinkMeasure;
  amountGbp: number;
  priceText: string;
  statement: string | null;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
  readDay: string;
};

export function selectSummonPrice(_venue: Venue | null | undefined, _nowMs: number): SummonPriceEvidence | null {
  return null;
}
