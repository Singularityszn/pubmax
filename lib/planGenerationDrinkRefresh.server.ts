import "server-only";

import { bundleDrinkFieldsFromPrintedName } from "@/lib/bundleDrinkFields";
import type { CityId } from "@/lib/cities";
import { listedCategoryPrices } from "@/lib/listedCategoryPrices";
import type { NightContext } from "@/lib/nightPlanning";
import type { PlanGenerationDrinkRefresh } from "@/lib/planGenerationDrinkRefresh";
import type { PlanGenerationAnchor } from "@/lib/planGenerationRequest";
import { cleanSelectedDrinkPriceEvidence, selectedDrinkPriceEvidenceMatchesContext,
  type SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import { resolvePlanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence.server";
import { resolvePlanningAnchor } from "@/lib/planningAnchor.server";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";

/** Refresh the same venue-local named offer, never relax accepted-quote checks. */
async function resolvePlanGenerationDrinkRefresh(
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

type AnchorDrinkResult =
  | { status: "unchanged"; anchor: PlanGenerationAnchor | null }
  | { status: "approved"; anchor: PlanGenerationAnchor; venueId: string; evidence: SelectedDrinkPriceEvidence }
  | { status: "conflict"; reason: string; message: string };

/** Resolve generation's quote authority before either candidate or base-anchor planning. */
export async function resolvePlanGenerationAnchorDrink(
  anchor: PlanGenerationAnchor | null,
  cityId: CityId,
  context: NightContext,
  now: number,
): Promise<AnchorDrinkResult> {
  const refresh = anchor?.selectedDrinkRefresh;
  const acceptedHint = anchor?.selectedDrinkPriceEvidence;
  if (!anchor || (!refresh && (!acceptedHint || context.zeroProof || acceptedHint.category !== context.drinkCategory))) {
    return { status: "unchanged", anchor };
  }
  const canonical = await resolvePlanningAnchor({ cityId, venueId: anchor.venueId,
    startsAt: anchor.startsAt, acceptedArea: anchor.acceptedArea, now });
  if (canonical.status === "conflict") {
    return { status: "conflict", reason: canonical.code, message: canonical.message };
  }
  const approved = refresh
    ? await resolvePlanGenerationDrinkRefresh(canonical.canonical.venueId, refresh, context, now)
    : (await resolvePlanSelectedDrinkPriceEvidence(
      [{ venueId: canonical.canonical.venueId, venueName: canonical.display.venueName }],
      [{ selectedDrinkPriceEvidence: acceptedHint }], context))[0]?.selectedDrinkPriceEvidence;
  if (!approved) return { status: "conflict", reason: "ANCHOR_ROUTE_CONFLICT", message:
    refresh ? "We couldn't check a current price for that saved drink and serving. Choose a current offer to change the route."
      : "That accepted menu price could not be checked. Open the pub and choose its current offer again." };
  const approvedAnchor = refresh
    ? { venueId: anchor.venueId, source: anchor.source, acceptedArea: anchor.acceptedArea,
      startsAt: anchor.startsAt, selectedDrinkPriceEvidence: approved }
    : anchor;
  return { status: "approved", anchor: approvedAnchor, venueId: canonical.canonical.venueId, evidence: approved };
}
