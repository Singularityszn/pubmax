import "server-only";

import { readCommunityPriceCategoryIndex } from "@/lib/communityPriceStore";
import { trustedDrinkLensPrices } from "@/lib/mapExperienceLens";
import { cleanNightContext } from "@/lib/nightPlanning";
import type { PlanStopTarget } from "@/lib/planRoute";
import { cleanSelectedDrinkPriceEvidence, type SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";

type PricedPlanStopTarget = PlanStopTarget & { selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence };

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
      const rows = rowsByVenue.get(row.venueId) ?? [];
      rowsByVenue.set(row.venueId, [...rows, row]);
    }
    const trusted = trustedDrinkLensPrices(rowsByVenue, category, now);
    return targets.map((stop, position) => {
      const hint = requested[position];
      const price = trusted.get(stop.venueId);
      if (!hint || hint.category !== category || !price || price.source !== "community"
        || typeof price.submittedAt !== "number") return { ...stop };
      const serverEvidence = cleanSelectedDrinkPriceEvidence({
        category, pence: Math.round(price.priceGbp * 100), serving: null,
        source: "community", reportedAt: new Date(price.submittedAt).toISOString(),
      });
      return serverEvidence?.source === "community" && hint.source === "community"
        && serverEvidence.pence === hint.pence && serverEvidence.reportedAt === hint.reportedAt
        ? { ...stop, selectedDrinkPriceEvidence: serverEvidence }
        : { ...stop };
    });
  } catch {
    return targets;
  }
}
