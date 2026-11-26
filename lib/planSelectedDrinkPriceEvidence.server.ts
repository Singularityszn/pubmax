import "server-only";

import { canonicalBundledVenueId } from "@/lib/bundledVenueAliases";
import { readCommunityPriceCategoryIndex, readCommunityPricesWithStatus } from "@/lib/communityPriceStore";
import { trustedDrinkLensPrices } from "@/lib/mapExperienceLens";
import { cleanNightContext } from "@/lib/nightPlanning";
import type { PlanStopTarget } from "@/lib/planRoute";
import type { PlanStopDTO } from "@/lib/plan";
import { cleanSelectedDrinkPriceEvidence, selectedDrinkPriceEvidenceForPrice, type SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";

type PricedPlanStopTarget = PlanStopTarget & { selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence };

function withoutSelectedDrinkEvidence(stop: PlanStopDTO): PlanStopDTO {
  const copy = { ...stop };
  delete copy.selectedDrinkPriceEvidence;
  return copy;
}

/** Keep a saved claim only while the current public price still supports it. */
export async function revalidateSavedDrinkEvidence(stops: readonly PlanStopDTO[]): Promise<PlanStopDTO[]> {
  const categories = [...new Set(stops.flatMap((stop) => stop.selectedDrinkPriceEvidence ? [stop.selectedDrinkPriceEvidence.category] : []))];
  if (categories.length === 0) return [...stops];
  try {
    const now = Date.now();
    const ids = [...new Set(stops.filter((stop) => stop.selectedDrinkPriceEvidence).map((stop) => canonicalBundledVenueId(stop.venueId)))];
    const reads = await Promise.all(ids.map((id) => readCommunityPricesWithStatus(id, now)));
    const rowsByVenue = new Map(ids.map((id, index) => [id, reads[index]?.degraded ? [] : reads[index]?.prices ?? []]));
    const trusted = new Map(categories.map((category) => [category, trustedDrinkLensPrices(rowsByVenue, category, now)]));
    return stops.map((stop) => {
      const evidence = stop.selectedDrinkPriceEvidence;
      if (!evidence) return stop;
      const price = trusted.get(evidence.category)?.get(canonicalBundledVenueId(stop.venueId));
      const current = selectedDrinkPriceEvidenceForPrice(price, { drinkCategory: evidence.category, zeroProof: false });
      if (current && current.pence === evidence.pence && current.reportedAt === evidence.reportedAt) return stop;
      return withoutSelectedDrinkEvidence(stop);
    });
  } catch {
    return stops.map(withoutSelectedDrinkEvidence);
  }
}

/** Resolve a submitted display hint against current, trusted server price rows. */
export async function resolvePlanSelectedDrinkPriceEvidence(
  stops: readonly PlanStopTarget[],
  submitted: readonly unknown[],
  rawContext: unknown,
): Promise<PricedPlanStopTarget[]> {
  const targets = stops.map(({ venueId, venueName }) => ({ venueId, venueName }));
  const context = cleanNightContext(rawContext);
  const category = context?.zeroProof ? null : context?.drinkCategory;
  if (!category || category === "beer") return targets;
  const requested = submitted.map((raw) => cleanSelectedDrinkPriceEvidence(
    raw && typeof raw === "object" ? (raw as Record<string, unknown>).selectedDrinkPriceEvidence : null,
  ));
  if (!requested.some((evidence) => evidence?.category === category)) return targets;

  const now = Date.now();
  try {
    const index = await readCommunityPriceCategoryIndex([category], now);
    if (index.degraded || index.truncated) return targets;
    const rowsByVenue = new Map<string, typeof index.prices>();
    for (const row of index.prices) {
      const venueId = canonicalBundledVenueId(row.venueId);
      const rows = rowsByVenue.get(venueId) ?? [];
      rowsByVenue.set(venueId, [...rows, row]);
    }
    const trusted = trustedDrinkLensPrices(rowsByVenue, category, now);
    return targets.map((stop, position) => {
      const hint = requested[position];
      const price = trusted.get(canonicalBundledVenueId(stop.venueId));
      if (!hint || hint.category !== category || !price || price.source !== "community"
        || typeof price.submittedAt !== "number") return { ...stop };
      const serverEvidence = selectedDrinkPriceEvidenceForPrice(price, context!);
      return serverEvidence && serverEvidence.pence === hint.pence && serverEvidence.reportedAt === hint.reportedAt
        ? { ...stop, selectedDrinkPriceEvidence: serverEvidence }
        : { ...stop };
    });
  } catch {
    return targets;
  }
}
