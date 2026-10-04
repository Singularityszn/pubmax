import "server-only";

import { bundleDrinkFieldsFromPrintedName } from "@/lib/bundleDrinkFields";
import { listedCategoryPrices } from "@/lib/listedCategoryPrices";
import type { NightContext } from "@/lib/nightPlanning";
import type { PlanGenerationDrinkRefresh } from "@/lib/planGenerationDrinkRefresh";
import { cleanSelectedDrinkPriceEvidence, selectedDrinkPriceEvidenceMatchesContext,
  type SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";

/** Refresh the same venue-local named offer, never relax accepted-quote checks. */
export async function resolvePlanGenerationDrinkRefresh(
  venueId: string,
  selection: PlanGenerationDrinkRefresh,
  context: NightContext,
  now: number,
): Promise<SelectedDrinkPriceEvidence | null> {
  const bundle = await ukPriceBundleRowsFor(venueId).catch(() => null);
  if (bundle?.status !== "ready") return null;
  const quote = listedCategoryPrices(bundle.rows, now, {
    includeBeer: selection.category === "beer", serving: selection.serving,
    drinkLabel: selection.drinkLabel, drinkSubtype: selection.drinkSubtype,
  }).find((candidate) => candidate.category === selection.category && candidate.servingSize === selection.serving);
  if (!quote) return null;
  const identity = bundleDrinkFieldsFromPrintedName(quote.drinkLabel, quote.category);
  if (identity.drinkLabel !== selection.drinkLabel || (identity.drinkSubtype ?? null) !== selection.drinkSubtype) return null;
  const evidence = cleanSelectedDrinkPriceEvidence({
    category: quote.category, pence: Math.round(quote.priceGbp * 100), serving: quote.servingSize,
    source: "listed", sourceUrl: quote.sourceUrl, observedAt: quote.observedAt,
    drinkLabel: identity.drinkLabel, drinkSubtype: identity.drinkSubtype ?? null,
  });
  return evidence && selectedDrinkPriceEvidenceMatchesContext(evidence, context) ? evidence : null;
}
